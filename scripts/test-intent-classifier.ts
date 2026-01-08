/**
 * Intent Classifier Enhancement - Test Suite
 * 
 * Run this to validate that the intent classifier correctly extracts
 * user ideas from messages containing reel URLs.
 * 
 * Usage:
 *   npx ts-node scripts/test-intent-classifier.ts
 */

import { intentClassifier } from '../src/services/chatbot/intentClassifier.service';
import { ChatbotState } from '../src/services/chatbot/chatbotStateMachine.service';

// ════════════════════════════════════════════════════════════════════════════
// TEST CASES
// ════════════════════════════════════════════════════════════════════════════

interface TestCase {
    name: string;
    message: string;
    expectedIntent: string;
    expectedUrl?: string;
    expectedIdea?: string;
    userState?: ChatbotState;
}

const testCases: TestCase[] = [
    // ─────────────────────────────────────────────────────────────────────────
    // NEW_REEL with Idea Extraction
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: "Idea Before URL",
        message: "make this video for gym athletic https://instagram.com/reel/xyz/",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/xyz/",
        expectedIdea: "gym athletic",
        userState: ChatbotState.IDLE,
    },
    {
        name: "Idea After URL",
        message: "https://instagram.com/reel/abc/ about cooking for beginners",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/abc/",
        expectedIdea: "cooking for beginners",
        userState: ChatbotState.IDLE,
    },
    {
        name: "Create This About...",
        message: "create this about software engineering https://instagram.com/reel/def/",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/def/",
        expectedIdea: "software engineering",
        userState: ChatbotState.IDLE,
    },
    {
        name: "Generic Tone (Funny)",
        message: "make it funny https://instagram.com/reel/ghi/",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/ghi/",
        expectedIdea: "funny",
        userState: ChatbotState.IDLE,
    },
    {
        name: "Complex Multi-Part Idea",
        message: "create this video about software engineering for beginners who want to learn Python https://instagram.com/reel/jkl/",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/jkl/",
        expectedIdea: "software engineering for beginners who want to learn Python",
        userState: ChatbotState.IDLE,
    },
    {
        name: "URL Only (No Idea)",
        message: "https://instagram.com/reel/mno/",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/mno/",
        expectedIdea: undefined, // Should be null/undefined
        userState: ChatbotState.IDLE,
    },
    {
        name: "Turn This Into...",
        message: "turn this into fitness motivation https://instagram.com/reel/pqr/",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/pqr/",
        expectedIdea: "fitness motivation",
        userState: ChatbotState.IDLE,
    },
    {
        name: "Generate For...",
        message: "generate this for real estate agents https://instagram.com/reel/stu/",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/stu/",
        expectedIdea: "for real estate agents", // "for" is kept as it provides context
        userState: ChatbotState.IDLE,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Other Intents (Should Still Work)
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: "Variation Intent",
        message: "again",
        expectedIntent: "VARIATION",
        expectedUrl: undefined,
        expectedIdea: undefined,
        userState: ChatbotState.AWAITING_FEEDBACK,
    },
    {
        name: "Copy Intent",
        message: "copy",
        expectedIntent: "COPY",
        expectedUrl: undefined,
        expectedIdea: undefined,
        userState: ChatbotState.AWAITING_FEEDBACK,
    },
    {
        name: "Help Intent",
        message: "help",
        expectedIntent: "HELP",
        expectedUrl: undefined,
        expectedIdea: undefined,
        userState: ChatbotState.IDLE,
    },
    {
        name: "Submit Idea (Two-Message Flow)",
        message: "make it about fitness and health",
        expectedIntent: "SUBMIT_IDEA",
        expectedUrl: undefined,
        expectedIdea: "make it about fitness and health",
        userState: ChatbotState.AWAITING_IDEA,
    },

    // ─────────────────────────────────────────────────────────────────────────
    // Edge Cases
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: "Very Short Idea (Should Be Null)",
        message: "ab https://instagram.com/reel/vwx/",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/vwx/",
        expectedIdea: undefined, // Too short (< 3 chars)
        userState: ChatbotState.IDLE,
    },
    {
        name: "Multiple Cleaning Phrases",
        message: "make this video about fitness for me https://instagram.com/reel/yza/",
        expectedIntent: "NEW_REEL",
        expectedUrl: "https://instagram.com/reel/yza/",
        expectedIdea: "fitness for me", // "for me" is kept - AI understands personal context
        userState: ChatbotState.IDLE,
    },
];

// ════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ════════════════════════════════════════════════════════════════════════════

function runTests() {
    console.log('\n🧪 Running Intent Classifier Enhancement Tests...\n');
    console.log('═'.repeat(80));

    let passed = 0;
    let failed = 0;

    for (const test of testCases) {
        const state = test.userState || ChatbotState.IDLE;
        const result = intentClassifier.classify(test.message, state);

        // Check intent
        const intentMatch = result.intent === test.expectedIntent;

        // Check URL
        const urlMatch = test.expectedUrl
            ? result.extractedData.reelUrl === test.expectedUrl
            : result.extractedData.reelUrl === undefined;

        // Check idea
        const ideaMatch = test.expectedIdea
            ? result.extractedData.userIdea === test.expectedIdea
            : !result.extractedData.userIdea; // Should be null/undefined

        const testPassed = intentMatch && urlMatch && ideaMatch;

        if (testPassed) {
            passed++;
            console.log(`✅ PASS: ${test.name}`);
        } else {
            failed++;
            console.log(`❌ FAIL: ${test.name}`);
            console.log(`   Message: "${test.message}"`);
            console.log(`   Expected Intent: ${test.expectedIntent} | Got: ${result.intent}`);
            if (test.expectedUrl) {
                console.log(`   Expected URL: ${test.expectedUrl}`);
                console.log(`   Got URL: ${result.extractedData.reelUrl || 'null'}`);
            }
            if (test.expectedIdea !== undefined) {
                console.log(`   Expected Idea: "${test.expectedIdea}"`);
                console.log(`   Got Idea: "${result.extractedData.userIdea || 'null'}"`);
            }
            console.log(`   Matched Rule: ${result.matchedRule}`);
            console.log(`   Reason: ${result.reason}`);
        }
    }

    console.log('═'.repeat(80));
    console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed out of ${testCases.length} total\n`);

    if (failed === 0) {
        console.log('🎉 All tests passed! Intent classifier is working correctly.\n');
        process.exit(0);
    } else {
        console.log('⚠️  Some tests failed. Please review the output above.\n');
        process.exit(1);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// RUN
// ════════════════════════════════════════════════════════════════════════════

runTests();
