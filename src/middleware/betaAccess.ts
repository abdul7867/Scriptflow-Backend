import { Request, Response, NextFunction } from 'express';
import { User, IUser } from '../db/models/User';
import { logger } from '../utils/logger';

/**
 * Beta Access Control Middleware
 * 
 * Only the first X users get access, others are put on waitlist.
 * Configure MAX_USERS via environment variable.
 */

const MAX_USERS = parseInt(process.env.MAX_BETA_USERS || '100', 10);

/**
 * Check user access and register new users
 */
export const betaAccessControl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const subscriberId = req.body?.subscriber_id;

    if (!subscriberId) {
      return res.status(400).json({
        status: 'error',
        code: 'MISSING_SUBSCRIBER_ID',
        message: 'subscriber_id is required'
      });
    }

    // Check if user exists
    let user = await User.findOne({ subscriberId });

    if (user) {
      // Existing user - check their status
      if (user.accessStatus === 'blocked') {
        return res.status(403).json({
          status: 'error',
          code: 'USER_BLOCKED',
          message: 'Your access has been suspended.'
        });
      }

      if (user.accessStatus === 'waitlist') {
        // Check if slots opened up (user might have been on waitlist but now has a slot)
        const activeCount = await User.countDocuments({ accessStatus: 'active' });
        
        if (activeCount < MAX_USERS) {
          // Promote from waitlist!
          user.accessStatus = 'active';
          user.registrationNumber = activeCount + 1;
          await user.save();
          logger.info(`User promoted from waitlist: ${subscriberId} (slot ${user.registrationNumber})`);
        } else {
          // Still on waitlist
          const waitlistPosition = await User.countDocuments({
            accessStatus: 'waitlist',
            createdAt: { $lt: user.createdAt }
          }) + 1;

          return res.status(202).json({
            status: 'waitlist',
            code: 'ON_WAITLIST',
            message: `🎉 Thanks for your interest! You're #${waitlistPosition} on the waitlist. We'll notify you when a spot opens up!`,
            position: waitlistPosition
          });
        }
      }

      // User is active - update stats and proceed
      user.totalRequests += 1;
      user.lastRequestAt = new Date();
      await user.save();

      // Attach user to request for downstream use
      (req as any).user = user;
      return next();
    }

    // New user - check if we have capacity
    const activeCount = await User.countDocuments({ accessStatus: 'active' });

    if (activeCount < MAX_USERS) {
      // Grant access!
      user = await User.create({
        subscriberId,
        accessStatus: 'active',
        registrationNumber: activeCount + 1,
        totalRequests: 1,
        lastRequestAt: new Date()
      });

      logger.info(`New user registered: ${subscriberId} (slot ${user.registrationNumber}/${MAX_USERS})`);
      (req as any).user = user;
      return next();
    }

    // No capacity - add to waitlist
    const waitlistCount = await User.countDocuments({ accessStatus: 'waitlist' });
    
    user = await User.create({
      subscriberId,
      accessStatus: 'waitlist',
      totalRequests: 0
    });

    logger.info(`New user added to waitlist: ${subscriberId} (position ${waitlistCount + 1})`);

    return res.status(202).json({
      status: 'waitlist',
      code: 'ADDED_TO_WAITLIST',
      message: `🚀 We're at full capacity right now! You're #${waitlistCount + 1} on the waitlist. We'll notify you as soon as a spot opens up!`,
      position: waitlistCount + 1
    });

  } catch (error) {
    logger.error('Beta access control error:', error);
    // SECURITY: Fail closed - deny access if we can't verify
    return res.status(503).json({
      status: 'error',
      code: 'SERVICE_UNAVAILABLE',
      message: 'Unable to verify access. Please try again in a moment.'
    });
  }
};

/**
 * Get current beta stats
 */
export async function getBetaStats() {
  const [activeCount, waitlistCount, totalRequests] = await Promise.all([
    User.countDocuments({ accessStatus: 'active' }),
    User.countDocuments({ accessStatus: 'waitlist' }),
    User.aggregate([{ $group: { _id: null, total: { $sum: '$totalRequests' } } }])
  ]);

  return {
    maxUsers: MAX_USERS,
    activeUsers: activeCount,
    availableSlots: Math.max(0, MAX_USERS - activeCount),
    waitlistSize: waitlistCount,
    totalRequests: totalRequests[0]?.total || 0
  };
}

/**
 * Manually grant access to a waitlisted user
 */
export async function grantAccess(subscriberId: string): Promise<boolean> {
  const user = await User.findOne({ subscriberId, accessStatus: 'waitlist' });
  
  if (!user) {
    return false;
  }

  const activeCount = await User.countDocuments({ accessStatus: 'active' });
  
  user.accessStatus = 'active';
  user.registrationNumber = activeCount + 1;
  await user.save();

  logger.info(`Access granted to: ${subscriberId} (slot ${user.registrationNumber})`);
  return true;
}

/**
 * Remove a user (frees up a slot)
 */
export async function removeUser(subscriberId: string): Promise<boolean> {
  const result = await User.deleteOne({ subscriberId });
  
  if (result.deletedCount > 0) {
    logger.info(`User removed: ${subscriberId}`);
    return true;
  }
  return false;
}

/**
 * Get waitlist in order
 */
export async function getWaitlist(limit: number = 50) {
  return User.find({ accessStatus: 'waitlist' })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('subscriberId createdAt name email');
}

/**
 * Promote next user from waitlist
 */
export async function promoteNextFromWaitlist(): Promise<IUser | null> {
  const activeCount = await User.countDocuments({ accessStatus: 'active' });
  
  if (activeCount >= MAX_USERS) {
    return null; // No slots available
  }

  const nextUser = await User.findOneAndUpdate(
    { accessStatus: 'waitlist' },
    { 
      accessStatus: 'active', 
      registrationNumber: activeCount + 1 
    },
    { 
      sort: { createdAt: 1 }, // Oldest waitlist entry first
      new: true 
    }
  );

  if (nextUser) {
    logger.info(`Promoted from waitlist: ${nextUser.subscriberId} (slot ${nextUser.registrationNumber})`);
  }

  return nextUser;
}
