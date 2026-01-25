# ScriptFlow Image Generator Lambda

This is a standalone AWS Lambda function that handles image generation for ScriptFlow.
It uses `satori` and `@resvg/resvg-js` to convert HTML to PNG.

## 🚀 Deployment Instructions (Important!)

This function relies on `@resvg/resvg-js`, which uses a native binary.
**If you are on Windows, you CANNOT just zip this folder and upload it.** AWS Lambda runs on Linux, so it needs the Linux binary.

### Option 1: The Easy Way (Use a Pre-Built Layer or Docker)
The most reliable way to deploy this is to package it using Docker, which simulates the Lambda environment.

1.  **Install Docker** (if you haven't).
2.  Run the following command in this directory:
    ```bash
    docker run -v "%cd%":/var/task -w /var/task node:18-buster sh -c "npm install && zip -r function.zip ."
    ```
    *(Note: On Mac/Linux use `$PWD` instead of `%cd%`)*.

3.  Upload `function.zip` to AWS Lambda.

### Option 2: The Manual Way (If you don't have Docker)
You must find a way to run `npm install` on a Linux machine (like a WSL terminal or an EC2 instance), zip the `node_modules`, and bring them back here.

## ⚙️ Configuration
Set these Environment Variables in your AWS Lambda Console:

*   `CLOUDINARY_URL`: Your Cloudinary URL (e.g. `cloudinary://...`)
*   `IMGBB_API_KEY`: (Fallback) Your ImgBB API Key
*   `IMAGE_PROVIDER`: `cloudinary` (Recommended)

## ⚡ Function Specs
*   **Runtime**: Node.js 18.x or 20.x
*   **Memory**: 1024 MB (Recommended)
*   **Timeout**: 15 seconds
*   **Handler**: `index.handler`
