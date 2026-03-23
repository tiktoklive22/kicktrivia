# Kick Quiz System - Project Structure

## Overview
This is a real-time interactive quiz system for Kick streamers with live chat integration, leaderboarding, and theater mode.

## Directory Structure

```
project/
├── src/
│   ├── App.tsx           # Main React component (Quiz logic, UI rendering)
│   ├── index.css         # Global styles with Tailwind CSS
│   └── main.tsx          # Application entry point
├── api/
│   └── generate.js       # API utilities
├── dist/                 # Build output (generated)
├── public/               # Static assets
├── vite.config.ts        # Vite configuration
├── tsconfig.json         # TypeScript configuration
├── package.json          # Project dependencies
├── index.html            # HTML entry point
└── README.md             # Project documentation

```

## Key Files

### `/src/App.tsx` (1589 lines)
**Main Application Component**
- **Purpose**: Contains the entire Kick Quiz application logic and UI
- **Key Features**:
  - WebSocket connection to Kick chat (Pusher)
  - CSV question parsing from Google Sheets
  - Real-time leaderboard management
  - Quiz state management (start, pause, skip, stop)
  - Theater mode for streaming
  - Arabic translation support (via Google Gemini AI)
  - Live chat message processing
  - Point calculation system

- **Major State Variables**:
  - `channel` - Kick streamer channel name
  - `isQuizRunning` - Quiz active state
  - `questions` - All loaded questions
  - `leaderboard` - User scores and stats
  - `timeLeft` - Current question timer
  - `messages` - Live chat messages
  - `isTheaterMode` - Full-screen presentation mode

- **Main Functions**:
  - `connectToKick()` - Establishes WebSocket connection
  - `fetchQuestions()` - Loads questions from Google Sheets CSV
  - `startQuiz()` - Initializes quiz session
  - `handleIncomingMessage()` - Processes chat messages
  - `translateQuestion()` - Generates Arabic translations

### `/src/index.css` (20 lines)
**Global Styles**
- Tailwind CSS configuration
- Custom utilities (scrollbar-hide, dir-rtl for Arabic)
- Google Fonts import (Droid Arabic Kufi)
- Theme customization

### `/src/main.tsx`
**Application Entry Point**
- Mounts React app to DOM
- Loads global styles

### `/vite.config.ts`
**Vite Build Configuration**
- React plugin setup
- HMR configuration

### `/package.json`
**Project Dependencies**
- **Key Libraries**:
  - `react` & `react-dom` - UI framework
  - `tailwindcss` - Styling
  - `motion` - Animations
  - `lucide-react` - Icon library
  - `@google/genai` - AI translations
  - `papaparse` - CSV parsing
  - `vite` - Build tool
  - TypeScript, Express, dotenv

## Features by Component

### 1. **Chat Integration**
- WebSocket connection to Kick's Pusher service
- Real-time message processing
- User registration via `!quiz` command
- Answer validation and scoring

### 2. **Quiz Engine**
- Question loading from Google Sheets
- Category filtering
- Timed questions (15s, 20s, 30s options)
- Multiple choice support (A, B, C, D)
- Full answer text matching
- Single attempt per question per user

### 3. **Scoring System**
- 10 points for full answer text
- 5 points for letter (A, B, C, D)
- Real-time leaderboard updates
- Moroccan timezone timestamps

### 4. **UI/UX**
- Dark theme with neon green accent (#53FC18)
- Theater mode for OBS streaming
- Animated transitions
- Responsive design (mobile to desktop)
- Top 3 podium display
- Live viewer count
- Streamer verification badge

### 5. **Advanced Features**
- Arabic question translation (Google Gemini)
- Reading time before answer submissions
- Pause/Resume functionality
- Skip question option
- Category selection
- Full leaderboard table with stats

## Data Flow

```
Kick Chat (WebSocket)
    ↓
handleIncomingMessage()
    ↓
User Registration (!quiz) / Answer Processing
    ↓
Leaderboard Update (State)
    ↓
UI Re-render (Animated)
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + TypeScript |
| **Styling** | Tailwind CSS 4.1 |
| **Animations** | Motion (Framer Motion alternative) |
| **Icons** | Lucide React |
| **CSV Parsing** | PapaParse |
| **AI/Translation** | Google Gemini API |
| **Build Tool** | Vite 6 |
| **Chat Integration** | WebSocket (Pusher) |

## Environment Setup

Requires environment variables (in `.env`):
```
GEMINI_API_KEY=your_api_key
```

## Running the Project

```bash
# Development
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Lint TypeScript
npm run lint

# Clean dist folder
npm clean
```

## File Size Overview

- **Main Bundle**: ~675 KB (178 KB gzipped)
- **CSS**: 15.21 KB (3.16 KB gzipped)
- **HTML**: 0.41 KB (0.28 KB gzipped)

---

**Created by**: Graphiicc
**Last Updated**: 2026-03-23
