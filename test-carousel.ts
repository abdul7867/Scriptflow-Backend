import { generateCarouselImages } from './src/services/ai/carouselGenerator.service';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config();

/**
 * Sample script text with clear sections
 */
const sampleScript = `
🎬 [HOOK (0-3s)]
Visual: A close-up of a high-end camera lens catching the golden hour light.
On-Screen: "The Secret to Viral Reels"
Dialogue: "If you're trying to help your brother truly shine in that next reel, stop making these 3 common mistakes."

📝 [BODY (3-15s)]
Visual: Fast-paced montage of a phone screen editing in CapCut, then showing a side-by-side comparison of old vs new editing style.
On-Screen: "Mistake #1: Bad Lighting"
Dialogue: "First, you need to understand that lighting is 80% of the game. Even a cheap phone looks elite with natural side-light. Second, stop using generic transitions that everyone's seen before."

🚀 [CTA (15-20s)]
Visual: A smiling creator pointing to the 'Save' button on Instagram.
On-Screen: "Save for your next reel!"
Dialogue: "Share this with your brother so he can level up his content today! And don't forget to follow for more elite editing tips."
`;

async function runTest() {
    console.log('🚀 Starting Carousel Generation Test...');
    console.log('-------------------------------------------');

    try {
        const images = await generateCarouselImages(sampleScript, 0);

        console.log('\n✅ Success! Generated Carousel Images:');
        console.log('-------------------------------------------');
        console.log(`🧲 HOOK CARD: ${images.hookCard}`);
        console.log(`📝 BODY CARD: ${images.bodyCard}`);
        console.log(`🚀 CTA CARD:  ${images.ctaCard}`);
        console.log('-------------------------------------------');
        console.log('You can open these URLs in your browser to see the design.');
    } catch (error) {
        console.error('\n❌ Test Failed!');
        console.error(error);
    }
}

runTest();
