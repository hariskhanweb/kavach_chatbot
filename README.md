# Chatbot Frontend

A clean, modern chatbot interface built with Next.js, styled similar to WhatsApp. This is a base template that can be easily forked and customized for your own chatbot projects.

## Features

- 🎨 Modern WhatsApp-like UI design
- 🔐 Access code authentication
- 💬 Real-time chat interface
- 📱 Responsive design
- 🚀 Static export ready for S3/Netlify deployment

## Getting Started

### 1. Install Dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

### 2. Configure API Endpoints

Edit `lib/chatbots.ts` and update the following values:

```typescript
export const API_ENDPOINT = 'https://investor.uniserved.com/api/ask/'
export const ACCESS_API_ENDPOINT = 'https://investor.uniserved.com/api/user-access/'
export const CHATBOT_NAME = 'Your Chatbot Name'
```

**Note:** This project uses static configuration (no environment variables) to support static site deployment.

### 3. Run Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## API Requirements

### Chat API Endpoint

**Endpoint:** `POST {API_ENDPOINT}` (configured in `lib/chatbots.ts`)

**Request Body:**
```json
{
  "question": "User's message",
  "phone": "User's phone number",
  "access_code": "User's access code"
}
```

**Response:**
```json
{
  "answer": "Bot's response message"
}
```

### Access Code Verification API

**Endpoint:** `POST {ACCESS_API_ENDPOINT}` (configured in `lib/chatbots.ts`)

**Request Body:**
```json
{
  "phone": "User's phone number",
  "access_code": "User's access code"
}
```

**Response:**
```json
{
  "is_authenticated": true,
  "message": "Authentication successful"
}
```

## Customization

### Update Chatbot Name

Edit `lib/chatbots.ts` and update the `CHATBOT_NAME` constant.

### Update Branding

- Logo: Replace `/public/logo-icon.png`
- Colors: Modify Tailwind classes in components (search for `#00A884`, `#0B141A`, etc.)
- Metadata: Update `app/page.tsx` and `app/layout.tsx`

## Build & Deploy

### Build for Production

```bash
npm run build
```

### Static Export

The project is configured for static export. The build output will be in the `out/` directory.

### Deploy to S3

```bash
npm run deploy
```

This will build the project and deploy to S3 using the `deploy-s3.ps1` script.

### Deploy to Netlify

The project includes `netlify.toml` configuration. Simply connect your repository to Netlify.

## Project Structure

```
├── app/                    # Next.js app directory
│   ├── page.tsx           # Main page
│   └── layout.tsx         # Root layout
├── components/            # React components
│   ├── ChatInterface.tsx  # Main chat component
│   ├── ChatMessage.tsx    # Message component
│   └── AccessCodeModal.tsx # Authentication modal
├── lib/                   # Utility functions
│   ├── chatbots.ts        # API configuration
│   └── accessCodes.ts     # Access code utilities
└── public/                # Static assets
```

## License

This is a base template. Feel free to fork and customize for your projects.
