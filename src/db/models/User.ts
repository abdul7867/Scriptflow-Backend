import mongoose, { Schema, Document } from 'mongoose';

/**
 * User Access Status
 */
export type UserAccessStatus = 'active' | 'waitlist' | 'blocked';

/**
 * User Document Interface
 * Tracks registered users and their access status
 */
export interface IUser extends Document {
  subscriberId: string;        // ManyChat subscriber_id
  accessStatus: UserAccessStatus;
  registrationNumber: number;  // What number user they are (1-100 = active)
  email?: string;              // Optional for waitlist notifications
  name?: string;               // From ManyChat if available
  totalRequests: number;       // Usage tracking
  lastRequestAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
  subscriberId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  accessStatus: { 
    type: String, 
    enum: ['active', 'waitlist', 'blocked'],
    default: 'waitlist',
    index: true
  },
  registrationNumber: {
    type: Number,
    index: true
  },
  email: String,
  name: String,
  totalRequests: { 
    type: Number, 
    default: 0 
  },
  lastRequestAt: Date
}, {
  timestamps: true
});

// Index for quick access checks
UserSchema.index({ subscriberId: 1, accessStatus: 1 });

export const User = mongoose.model<IUser>('User', UserSchema);
