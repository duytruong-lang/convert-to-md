# Convert to MD (mdconvert)

An AI-powered document conversion tool that transforms PDF, DOCX, and TXT files into high-fidelity Markdown. Utilizing Google's **Gemini 2.5 Pro Vision** model, this tool accurately extracts text, charts, and complex layouts from documents while maintaining semantic structure.

![MDConvert Cover](docs/screenshots/Home%20page.png)

## 🚀 Features

- **High-Fidelity PDF Vision Pipeline:** Uses `pdftoppm` to render PDF pages at 400 DPI, combined with `pdftotext` to extract the native text layer. Both are fed into Gemini 2.5 Pro Vision to ensure maximum accuracy for charts, tables, and dense text.
- **DOCX & TXT Support:** Integrates `pandoc` for native DOCX to Markdown conversion.
- **Batch Processing:** Upload multiple files simultaneously. The system queues and processes them sequentially to prevent AI rate-limiting and OOM errors.
- **Secure Authentication:** Built-in identity management using `next-auth` and `bcryptjs`. The app can be locked down for internal team use.
- **Auto-Cleanup & Optimization:** Built-in scheduler to clean up processed files after 24 hours. Includes optional Ghostscript-based PDF compression.

## 🛠 Prerequisites

Ensure the following system dependencies are installed on your host machine or container:

- **Node.js:** v18+ 
- **Poppler:** `pdftoppm` and `pdftotext` (Required for PDF Vision)
  - macOS: `brew install poppler`
  - Ubuntu/Debian: `sudo apt-get install poppler-utils`
- **Ghostscript:** (Required for PDF compression)
  - macOS: `brew install ghostscript`
  - Ubuntu/Debian: `sudo apt-get install ghostscript`
- **Pandoc:** (Required for DOCX conversion)
  - macOS: `brew install pandoc`
  - Ubuntu/Debian: `sudo apt-get install pandoc`

## 📦 Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/duytruong-lang/convert-to-md.git
   cd convert-to-md
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy the example environment file and update it with your credentials:
   ```bash
   cp .env.example .env
   ```
   **Required variables in `.env`:**
   - `DATABASE_URL`: Connection string for your database (default uses SQLite).
   - `NEXTAUTH_SECRET`: Generate a secure random string (e.g., `openssl rand -base64 32`).
   - `NEXTAUTH_URL`: The canonical URL of your deployment (e.g., `http://localhost:2023`).
   - `ENCRYPTION_KEY`: A 32-byte key for encrypting sensitive data like API keys in the database.

4. **Initialize the Database:**
   ```bash
   npx prisma generate
   npx prisma db push
   ```

## 💻 Running the Application

### Development Mode
```bash
npm run dev
```
The application will be available at `http://localhost:2023`.

### Production Mode (PM2 Recommended)
```bash
npm run build
npm start
```
For process management with PM2:
```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## 🐳 Docker Support

The project includes a ready-to-use `Dockerfile` and `docker-compose.yml` for containerized deployment, pre-configured with all necessary system dependencies (Poppler, Ghostscript, Pandoc).

```bash
# Build and start the container
docker-compose up -d --build
```

## 🔒 Security & Privacy

- **Data Encryption:** API keys and sensitive user configurations are encrypted at rest using AES-256-GCM.
- **Ephemeral Storage:** Uploaded and converted files are temporarily stored and automatically wiped after 24 hours.
- **Path Traversal Protection:** All file operations are sanitized using NFC normalization and strictly confined to isolated temporary directories.

## 📄 License
This project is open-source and available under the MIT License.
