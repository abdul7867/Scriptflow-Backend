# 🚀 CI/CD Pipeline Setup Guide

This guide explains how to set up the **Automated Deployment Pipeline** for ScriptFlow.
Once set up, any push to the `main` branch will automatically test, build, and deploy your code to the live server.

---

## 🔑 Phase 1: Docker Hub Setup
*We need a place to store your built application (The "Artifact").*

1.  Go to **[hub.docker.com](https://hub.docker.com/)** and create a free account.
2.  Click **Create Repository**.
3.  Name it: `scriptflow-backend`.
4.  Visibility: **Public** (Free) or **Private** (1 free private repo usually allowed).
5.  **Important:** Remember your Docker Hub `username` and `password`.

---

## 🔑 Phase 2: GitHub Secrets Setup
*You need to give the GitHub Robot permission to access your server and Docker Hub.*

1.  Go to your GitHub Repository: `https://github.com/abdul7867/Scriptflow-Backend`
2.  Navigate to **Settings** > **Secrets and variables** > **Actions**.
3.  Click **New repository secret** for each of the following:

| Secret Name | Value Example | Description |
| :--- | :--- | :--- |
| `DOCKER_USERNAME` | `abdul7867` | Your Docker Hub Username. |
| `DOCKER_PASSWORD` | `dckr_pat_...` | Your Docker Hub Password (or Access Token). |
| `HOST_DNS` | `3.120.224.17` | The Public IPv4 address of your AWS EC2 Server. |
| `EC2_SSH_KEY` | `-----BEGIN RSA PRIVATE KEY----- ...` | The content of your `.pem` key file (Open it with Notepad). |

---

## 🖥️ Phase 3: Server Preparation (One-Time)
*Your server needs to know it will be controlled by Docker.*

1.  SSH into your server manually one last time.
2.  Install Docker & Docker Compose (if not already installed).
3.  Make sure the project folder exists:
    ```bash
    git clone https://github.com/abdul7867/Scriptflow-Backend.git ~/Scriptflow-Backend
    ```
    *(If it already exists, just `cd` into it).*

---

## 🚀 How to Use It (The Workflow)

### 1. Daily Development (The Safety Zone)
When you are working on features, push to a `dev` or feature branch:
```bash
git checkout -b feature/new-cool-thing
# ... do work ...
git push origin feature/new-cool-thing
```
*   **GitHub Action:** Will run `npm run build` to check for errors.
*   **Server:** NOTHING happens (Safe).

### 2. Going Live (The Deployment)
When you are ready to update the live server:
```bash
git checkout main
git merge feature/new-cool-thing
git push origin main
```
*   **GitHub Action:**
    1.  Checks code quality.
    2.  Builds the Docker Image.
    3.  Uploads it to Docker Hub.
    4.  Logs into your server and updates the running app.
*   **Time taken:** ~3-5 minutes.
*   **Downtime:** ~10-20 seconds (while container restarts).

---

## 🆘 Troubleshooting

**Q: The deploy failed at "Login to Docker Hub".**
A: Check your `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets in GitHub.

**Q: The deploy failed at "Deploy to EC2".**
A: Check if your server IP (`HOST_DNS`) changed (if you rebooted EC2 without Elastic IP). Check if your `EC2_SSH_KEY` is correct.

**Q: The server isn't updating.**
A: Check the "Actions" tab in GitHub to see the logs. It will tell you exactly which step failed.
