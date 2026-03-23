import { useState, useEffect, useRef, useCallback } from 'react';
import { Trophy, MessageSquare, Play, Pause, Settings, Users, User, AlertCircle, BadgeCheck, CheckCircle2, Eye, Tag, Heart, ChevronLeft, ChevronRight, Maximize2, Minimize2, BookOpen, HelpCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Papa from 'papaparse';
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Question {
  question: string;
  answer: string;
  category: string;
  image?: string;
  options?: string[];
  arabicQuestion?: string;
}

interface UserStats {
  username: string;
  points: number;
  totalAnswered: number;
  correctAnswers: number;
  lastAnswerTimeStr: string; // Formatted Moroccan time
}

interface ChatMessage {
  id: string;
  username: string;
  content: string;
  timestamp: number;
}

export default function App() {
  const [channel, setChannel] = useState('odablock');
  const [streamerName, setStreamerName] = useState('');
  const [streamerImage, setStreamerImage] = useState('');
  const [streamTitle, setStreamTitle] = useState('');
  const [viewerCount, setViewerCount] = useState<number | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [sheetUrl, setSheetUrl] = useState('https://docs.google.com/spreadsheets/d/1dJU49TQM67xNWNtq_4WGBOK57Aw4PgyXkf4RpciCLXw/edit?usp=sharing');
  const [isConnected, setIsConnected] = useState(false);
  const [isQuizRunning, setIsQuizRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isReadingTime, setIsReadingTime] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<Question[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(-1);
  const [leaderboard, setLeaderboard] = useState<Record<string, UserStats>>({});
  const [registeredUsers, setRegisteredUsers] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isTheaterMode, setIsTheaterMode] = useState(false);
  const [footerTab, setFooterTab] = useState<'docs' | 'qa'>('docs');
  const [timerDuration, setTimerDuration] = useState(30);
  const [isTranslating, setIsTranslating] = useState(false);
  const categoryScrollRef = useRef<HTMLDivElement>(null);
  const [questionStartTime, setQuestionStartTime] = useState<number>(0);
  const timerSoundRef = useRef<HTMLAudioElement | null>(null);
  const tickSoundRef = useRef<HTMLAudioElement | null>(null);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const currentQuestionRef = useRef<Question | null>(null);
  const answeredUsersRef = useRef<Set<string>>(new Set());
  const registeredUsersRef = useRef<Set<string>>(new Set());
  const isQuizRunningRef = useRef(false);
  const isPausedRef = useRef(false);
  const isReadingTimeRef = useRef(false);
  const isTransitioningRef = useRef(false);
  const questionStartTimeRef = useRef(0);

  const [currentQuote, setCurrentQuote] = useState(0);

  const quotes = [
    "Don't use Google, use your brain! 🧠",
    "Work your brain, don't be a pro at searching! 🚀",
    "Real knowledge comes from within, not from a search engine! ✨",
    "Challenge yourself! No Google allowed! 🚫🔍",
    "Think fast, think smart! Brain power only! 💪"
  ];

  useEffect(() => {
    const quoteInterval = setInterval(() => {
      setCurrentQuote(prev => (prev + 1) % quotes.length);
    }, 8000);
    return () => clearInterval(quoteInterval);
  }, []);

  // Sync refs with state for use in callbacks
  useEffect(() => { isQuizRunningRef.current = isQuizRunning; }, [isQuizRunning]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { isReadingTimeRef.current = isReadingTime; }, [isReadingTime]);
  useEffect(() => { isTransitioningRef.current = isTransitioning; }, [isTransitioning]);
  useEffect(() => { questionStartTimeRef.current = questionStartTime; }, [questionStartTime]);
  useEffect(() => { registeredUsersRef.current = registeredUsers; }, [registeredUsers]);

  // Handle message logic
  const handleIncomingMessage = useCallback((username: string, content: string) => {
    const now = Date.now();
    const normalize = (s: string) => s.trim().toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '');
    const cleanContent = content.trim();

    // Handle registration
    if (cleanContent.toLowerCase() === '!quiz') {
      if (!registeredUsersRef.current.has(username)) {
        setRegisteredUsers(prev => {
          const next = new Set(prev);
          next.add(username);
          return next;
        });
        // Also initialize them in leaderboard if not exists
        setLeaderboard(prev => {
          if (prev[username]) return prev;
          return {
            ...prev,
            [username]: {
              username,
              points: 0,
              totalAnswered: 0,
              correctAnswers: 0,
              lastAnswerTimeStr: '-'
            }
          };
        });
        console.log(`User ${username} registered for the quiz!`);
      }
      return;
    }
    
    setMessages(prev => [{
      id: Math.random().toString(36).substring(7),
      username,
      content,
      timestamp: now
    }, ...prev].slice(0, 50));

    // Only process answers for registered users
    if (!registeredUsersRef.current.has(username)) {
      return;
    }

    if (isQuizRunningRef.current && !isPausedRef.current && !isReadingTimeRef.current && !isTransitioningRef.current && currentQuestionRef.current && !answeredUsersRef.current.has(username)) {
      const userAnswer = normalize(content);
      const currentQ = currentQuestionRef.current;
      const correctAnswer = normalize(currentQ.answer);

      let isCorrect = userAnswer === correctAnswer;
      let isLetterAnswer = false;
      let isAttempt = isCorrect;

      // Check for A, B, C, D if options exist
      if (!isCorrect && currentQ.options && userAnswer.length === 1) {
        const optionIndex = userAnswer.charCodeAt(0) - 97; // 'a' -> 0, 'b' -> 1, etc.
        if (optionIndex >= 0 && optionIndex < currentQ.options.length) {
          isAttempt = true;
          const selectedOption = normalize(currentQ.options[optionIndex]);
          if (selectedOption === correctAnswer) {
            isCorrect = true;
            isLetterAnswer = true;
          }
        }
      }

      // If they typed one of the other options fully, it's also an attempt
      if (!isAttempt && currentQ.options) {
        if (currentQ.options.some(opt => normalize(opt) === userAnswer)) {
          isAttempt = true;
        }
      }

      if (isAttempt) {
        // Mark as answered for THIS question - only one shot allowed!
        answeredUsersRef.current.add(username);

        if (isCorrect) {
          // Get Moroccan time
          const moroccanTime = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Africa/Casablanca',
            hour: 'numeric',
            minute: 'numeric',
            hour12: true
          }).format(new Date());

          setLeaderboard(prev => {
            const stats = prev[username] || { 
              username, 
              points: 0, 
              totalAnswered: 0, 
              correctAnswers: 0, 
              lastAnswerTimeStr: '-'
            };
            
            const pointsToAdd = isLetterAnswer ? 5 : 10;
            const newPoints = (stats.points || 0) + pointsToAdd;
            
            return {
              ...prev,
              [username]: {
                ...stats,
                points: newPoints,
                totalAnswered: (stats.totalAnswered || 0) + 1,
                correctAnswers: (stats.correctAnswers || 0) + 1,
                lastAnswerTimeStr: moroccanTime
              }
            };
          });
        } else {
          // If wrong, we still track the attempt but they can't try again
          setLeaderboard(prev => {
            const stats = prev[username] || { 
              username, 
              points: 0, 
              totalAnswered: 0, 
              correctAnswers: 0, 
              lastAnswerTimeStr: '-'
            };
            return {
              ...prev,
              [username]: {
                ...stats,
                totalAnswered: (stats.totalAnswered || 0) + 1
              }
            };
          });
        }
      }
    }
  }, []);

  const handleChannelChange = (val: string) => {
    let username = val;
    if (val.includes('kick.com/')) {
      username = val.split('kick.com/')[1].split('/')[0].split('?')[0];
    }
    setChannel(username);
  };

  const fetchStreamerInfo = async (channelName: string) => {
    if (!channelName) return;
    try {
      const res = await fetch(`https://kick.com/api/v2/channels/${channelName}`);
      if (res.ok) {
        const data = await res.json();
        setStreamerName(data.user.username);
        setStreamerImage(data.user.profile_pic);
        setIsVerified(data.verified || data.user.verified || false);
        if (data.livestream) {
          setStreamTitle(data.livestream.session_title);
          setViewerCount(data.livestream.viewer_count);
        } else {
          setStreamTitle("Offline");
          setViewerCount(0);
        }
      }
    } catch (err) {
      console.error("Failed to fetch streamer info:", err);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStreamerInfo(channel);
    }, 500);
    return () => clearTimeout(timer);
  }, [channel]);

  useEffect(() => {
    if (sheetUrl && sheetUrl.startsWith('https://docs.google.com/spreadsheets/d/')) {
      fetchQuestions();
    }
  }, [sheetUrl]);

  const connectToKick = async () => {
    if (wsRef.current) wsRef.current.close();
    setError(null);

    try {
      const kickWSUri = "wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=7.6.0&flash=false";
      const ws = new WebSocket(kickWSUri);
      wsRef.current = ws;

      ws.addEventListener("open", async () => {
        try {
          // Note: This might fail due to CORS in a standard browser environment.
          // In AI Studio, we hope it works or the user has a proxy.
          const res = await fetch(`https://kick.com/api/v2/channels/${channel}`);
          if (!res.ok) throw new Error(`Failed to fetch channel info: ${res.statusText}`);
          const data = await res.json();
          const chatroomId = data.chatroom.id;
          setIsVerified(data.verified || data.user.verified || false);
          setStreamerName(data.user.username);
          setStreamerImage(data.user.profile_pic);

          ws.send(JSON.stringify({
            event: "pusher:subscribe",
            data: {
              auth: "",
              channel: `chatrooms.${chatroomId}.v2`,
            },
          }));

          setIsConnected(true);
          console.log("Connected to chat:", channel);
        } catch (err) {
          setError("Could not fetch Kick channel info. CORS might be blocking the request.");
          console.error(err);
        }
      });

      ws.addEventListener("message", (event) => {
        const data = JSON.parse(event.data);
        if (data.event === "App\\Events\\ChatMessageEvent") {
          const msg = JSON.parse(data.data);
          handleIncomingMessage(msg.sender.username, msg.content);
        }
      });

      ws.addEventListener("close", () => {
        setIsConnected(false);
      });

    } catch (err) {
      setError("Failed to connect to WebSocket.");
      console.error(err);
    }
  };

  const fetchQuestions = async () => {
    if (!sheetUrl) {
      setError("Please provide a Google Sheets URL.");
      return;
    }

    try {
      // Convert standard URL to export URL if needed
      let url = sheetUrl;
      if (url.includes('/edit')) {
        url = url.replace(/\/edit.*$/, '/export?format=csv');
      } else if (!url.includes('format=csv')) {
        url += (url.includes('?') ? '&' : '?') + 'format=csv';
      }

      const response = await fetch(url);
      const csvText = await response.text();
      
      Papa.parse(csvText, {
        header: true,
        complete: (results) => {
          const validQuestions = results.data
            .filter((row: any) => row.Question && row.Answer)
            .map((row: any) => {
              // Try to find options
              let options: string[] = [];
              
              // Check for "Options" column (comma separated)
              if (row.Options) {
                options = row.Options.split(',').map((o: string) => o.trim()).filter(Boolean);
              } 
              // Check for explicit Option A, B, C, D columns
              else if (row['Option A'] || row.A || row['Option 1']) {
                const possibleKeys = [
                  ['Option A', 'Option B', 'Option C', 'Option D'],
                  ['A', 'B', 'C', 'D'],
                  ['Option 1', 'Option 2', 'Option 3', 'Option 4']
                ];
                
                for (const keys of possibleKeys) {
                  const found = keys.map(k => row[k]).filter(Boolean);
                  if (found.length > 0) {
                    options = found;
                    break;
                  }
                }
              }
              
              // Fallback: Check the 5th column (Column E) if still no options
              if (options.length === 0) {
                const rowKeys = Object.keys(row);
                if (rowKeys.length >= 5) {
                  const colEKey = rowKeys[4]; // 5th column
                  if (row[colEKey] && !['Question', 'Answer', 'Category', 'Image', 'image'].includes(colEKey)) {
                    // Try comma separated first
                    const split = row[colEKey].split(',').map((o: string) => o.trim()).filter(Boolean);
                    if (split.length > 1) {
                      options = split;
                    } else {
                      // Maybe it's just one option? Or maybe it's semicolon?
                      const semiSplit = row[colEKey].split(';').map((o: string) => o.trim()).filter(Boolean);
                      if (semiSplit.length > 1) options = semiSplit;
                    }
                  }
                }
              }
              
              // Check for Arabic columns
              let arabicQuestion = row['Arabic Question'] || row['Question Arabic'] || row['ArabicQuestion'];

              return {
                question: row.Question,
                answer: row.Answer,
                category: row.Category || 'General',
                image: row.image || row.Image || '',
                options: options.length > 0 ? options : undefined,
                arabicQuestion
              };
            });
          
          if (validQuestions.length === 0) {
            setError("No valid questions found in the sheet. Ensure columns are named 'Question' and 'Answer'.");
          } else {
            setQuestions(validQuestions);
            const cats = Array.from(new Set(validQuestions.map((q: any) => q.category))).filter(Boolean);
            setAvailableCategories(cats);
            setError(null);
          }
        },
        error: (err) => {
          setError("Error parsing CSV: " + err.message);
        }
      });
    } catch (err) {
      setError("Failed to fetch Google Sheet. Make sure it's public.");
    }
  };

  const startQuiz = () => {
    const filtered = selectedCategory === 'All' 
      ? [...questions] 
      : questions.filter(q => q.category === selectedCategory);

    if (filtered.length === 0) {
      setError("No questions found for the selected category.");
      return;
    }

    // Shuffle the questions to start at a random one
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    setQuizQuestions(shuffled);
    setIsQuizRunning(true);
    isQuizRunningRef.current = true;
    setIsPaused(false);
    isPausedRef.current = false;
    setIsReadingTime(false);
    isReadingTimeRef.current = false;
    setCurrentQuestionIndex(0);
    setLeaderboard({});
    setError(null);
    
    // Initialize audio
    if (!timerSoundRef.current) {
      timerSoundRef.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3'); // Beautiful alert chime
    }
    if (!tickSoundRef.current) {
      tickSoundRef.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
      tickSoundRef.current.volume = 0.3; // Subtle tick
    }
    if (!bgMusicRef.current) {
      bgMusicRef.current = new Audio('https://assets.mixkit.co/active_storage/audio/295/295-preview.mp3'); // Energetic quiz background music
      bgMusicRef.current.loop = true;
      bgMusicRef.current.volume = 0.15; // Low background volume
    }
    bgMusicRef.current.play().catch(e => console.error("BG Music play failed:", e));
  };

  const stopQuiz = () => {
    setIsQuizRunning(false);
    isQuizRunningRef.current = false;
    setIsPaused(false);
    isPausedRef.current = false;
    setCurrentQuestionIndex(-1);
    setIsTransitioning(false);
    isTransitioningRef.current = false;
    currentQuestionRef.current = null;
    
    if (bgMusicRef.current) {
      bgMusicRef.current.pause();
      bgMusicRef.current.currentTime = 0;
    }
  };

  const togglePause = () => {
    setIsPaused(prev => {
      const next = !prev;
      if (bgMusicRef.current) {
        if (next) {
          bgMusicRef.current.pause();
        } else {
          bgMusicRef.current.play().catch(e => console.error("BG Music play failed:", e));
        }
      }
      return next;
    });
  };

  const skipQuestion = () => {
    if (isQuizRunning && !isTransitioning) {
      setCurrentQuestionIndex(prev => prev + 1);
    }
  };

  const translateQuestion = async (q: Question, index: number) => {
    if (q.arabicQuestion) return;
    
    setIsTranslating(true);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Translate the following quiz question to Arabic. 
        Question: ${q.question}
        
        Return the result as JSON with fields: arabicQuestion.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              arabicQuestion: { type: Type.STRING }
            },
            required: ["arabicQuestion"]
          }
        }
      });

      const result = JSON.parse(response.text);
      
      setQuizQuestions(prev => {
        const next = [...prev];
        if (next[index]) {
          next[index] = {
            ...next[index],
            arabicQuestion: result.arabicQuestion
          };
        }
        return next;
      });
    } catch (err) {
      console.error("Translation failed:", err);
    } finally {
      setIsTranslating(false);
    }
  };

  useEffect(() => {
    if (isQuizRunning && currentQuestionIndex >= 0 && currentQuestionIndex < quizQuestions.length) {
      const q = quizQuestions[currentQuestionIndex];
      translateQuestion(q, currentQuestionIndex);
      
      currentQuestionRef.current = q;
      answeredUsersRef.current = new Set();
      const now = Date.now();
      setTimeLeft(timerDuration);
      setQuestionStartTime(now);
      questionStartTimeRef.current = now;
      setIsTransitioning(false);
      isTransitioningRef.current = false;
      
      // Start reading time
      setIsReadingTime(true);
      isReadingTimeRef.current = true;
      
      const readingTimer = setTimeout(() => {
        setIsReadingTime(false);
        isReadingTimeRef.current = false;
      }, 3000);

      const timer = setInterval(() => {
        if (isPausedRef.current || isReadingTimeRef.current) return;
        
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setIsTransitioning(true);
            isTransitioningRef.current = true;
            
            // Play end round sound
            if (timerSoundRef.current) {
              timerSoundRef.current.play().catch(e => console.error("Audio play failed:", e));
            }

            // Move to next question after a short delay
            setTimeout(() => {
              setCurrentQuestionIndex(idx => idx + 1);
            }, 5000); // 5 seconds to review answer and leaderboard
            return 0;
          }
          
          // Play tick sound every second
          if (tickSoundRef.current) {
            tickSoundRef.current.currentTime = 0;
            tickSoundRef.current.play().catch(e => console.warn("Tick sound failed:", e));
          }
          
          return prev - 1;
        });
      }, 1000);

      return () => {
        clearTimeout(readingTimer);
        clearInterval(timer);
      };
    } else if (isQuizRunning && currentQuestionIndex >= quizQuestions.length) {
      setIsQuizRunning(false);
      setIsTransitioning(false);
      currentQuestionRef.current = null;
      
      if (bgMusicRef.current) {
        bgMusicRef.current.pause();
        bgMusicRef.current.currentTime = 0;
      }
    }
  }, [isQuizRunning, currentQuestionIndex, quizQuestions]);

  const sortedLeaderboard = (Object.values(leaderboard) as UserStats[]).sort((a, b) => {
    return b.points - a.points;
  });

  const scrollCategories = (direction: 'left' | 'right') => {
    if (categoryScrollRef.current) {
      const scrollAmount = 200;
      categoryScrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className={`min-h-screen bg-[#0E0E10] text-white font-sans ${isTheaterMode ? 'p-0' : 'p-4 md:p-8'}`}>
      {/* Theater Mode Toggle (Floating) */}
      <motion.button 
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={() => setIsTheaterMode(!isTheaterMode)}
        className="fixed bottom-8 right-8 z-50 p-4 bg-[#53FC18] text-black rounded-full shadow-[0_0_20px_rgba(83,252,24,0.4)] hover:bg-[#46d614] transition-colors"
        title={isTheaterMode ? "Exit Theater Mode" : "Enter Theater Mode"}
      >
        {isTheaterMode ? <Minimize2 className="w-6 h-6" /> : <Maximize2 className="w-6 h-6" />}
      </motion.button>

      {/* Top Banner Section */}
      {!isTheaterMode && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-7xl mx-auto mb-12 bg-[#0E0E10] rounded-[2.5rem] border border-white/10 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)] overflow-hidden relative group"
        >
          {/* Background Effects */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(83,252,24,0.1),transparent_70%)]" />
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
          <div className="absolute inset-0 pointer-events-none opacity-[0.02]" style={{ backgroundImage: 'linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%), linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06))', backgroundSize: '100% 2px, 3px 100%' }} />
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#53FC18]/50 to-transparent" />
          
          <div className="p-10 flex flex-col lg:flex-row items-center gap-12 relative z-10">
            {/* Streamer Image Section */}
            <motion.div
              whileHover={{ scale: 1.02 }}
              className="relative shrink-0"
            >
              <div className="absolute -inset-4 bg-[#53FC18]/20 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              
              <div className="relative p-2 bg-[#18181B] rounded-full border border-white/10 shadow-2xl overflow-hidden">
                {/* Image Scanline Overlay */}
                <div className="absolute inset-0 z-20 pointer-events-none opacity-[0.05] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%)] bg-[length:100%_4px]" />
                
                {streamerImage ? (
                  <img 
                    src={streamerImage} 
                    alt={streamerName} 
                    className="w-44 h-44 rounded-full object-cover border-2 border-[#53FC18]/30 grayscale-[0.2] group-hover:grayscale-0 transition-all duration-500"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-44 h-44 rounded-full bg-[#0E0E10] border-2 border-white/5 flex items-center justify-center">
                    <Users className="w-20 h-20 text-gray-800" />
                  </div>
                )}
              </div>
            </motion.div>
            
            {/* Content Section */}
            <div className="flex-1 text-center lg:text-left space-y-8">
              <div className="space-y-2">
                <div className="flex items-center justify-center lg:justify-start gap-3 mb-1">
                  <div className="h-px w-8 bg-[#53FC18]/30" />
                  <span className="text-[10px] font-black uppercase tracking-[0.5em] text-[#53FC18]/60">Broadcast System v2.0</span>
                </div>
                
                <div className="flex flex-col lg:flex-row lg:items-end gap-2 lg:gap-6">
                  <motion.h1 
                    animate={{ 
                      textShadow: [
                        "0 0 20px rgba(83,252,24,0.1)",
                        "0 0 40px rgba(83,252,24,0.4)",
                        "0 0 20px rgba(83,252,24,0.1)"
                      ]
                    }}
                    transition={{ duration: 4, repeat: Infinity }}
                    className="text-6xl md:text-8xl font-black uppercase tracking-tighter italic text-white leading-[0.85] drop-shadow-2xl"
                  >
                    KICK <span className="text-[#53FC18]">QUIZ</span>
                  </motion.h1>
                  <div className="flex flex-col items-center lg:items-start">
                    <motion.span 
                      initial={{ width: 0 }}
                      animate={{ width: "auto" }}
                      transition={{ 
                        duration: 2, 
                        ease: "linear",
                        repeat: Infinity,
                        repeatType: "reverse",
                        repeatDelay: 2
                      }}
                      className="text-sm font-black uppercase tracking-[0.2em] text-gray-500 overflow-hidden whitespace-nowrap border-r-2 border-[#53FC18]/50 pr-1"
                      style={{ animation: 'blink 0.7s infinite step-end' }}
                    >
                      By Graphiicc
                    </motion.span>
                    <style>{`
                      @keyframes blink {
                        from, to { border-color: transparent }
                        50% { border-color: #53FC18 }
                      }
                    `}</style>
                    <div className="h-1 w-12 bg-[#53FC18] mt-1" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-center lg:justify-start gap-4">
                    <div className="flex items-center gap-2">
                      <h2 className="text-3xl font-black uppercase tracking-tight text-white">
                        {streamerName || channel}
                      </h2>
                      {isVerified && (
                        <div className="flex items-center justify-center">
                          <BadgeCheck className="w-6 h-6 text-[#53FC18] fill-[#53FC18]/10" />
                        </div>
                      )}
                    </div>
                    {isConnected && (
                      <div className="flex items-center gap-2 px-3 py-1 bg-[#53FC18]/10 border border-[#53FC18]/20 rounded-lg">
                        <div className="w-2 h-2 rounded-full bg-[#53FC18] animate-pulse" />
                        <span className="text-[10px] font-black text-[#53FC18] uppercase tracking-widest">Live Now</span>
                      </div>
                    )}
                  </div>
                  <p className="text-lg font-bold text-gray-500 line-clamp-1 italic border-l-2 border-[#53FC18]/30 pl-4">
                    {streamTitle || "System Ready for Deployment"}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center lg:justify-end gap-3">
                  <div className="flex flex-col items-center lg:items-end p-4 bg-white/5 rounded-2xl border border-white/5 min-w-[120px]">
                    <span className="text-[10px] font-black text-gray-600 uppercase tracking-widest mb-1">Channel</span>
                    <div className="flex items-center gap-2 text-white font-bold">
                      <Users className="w-4 h-4 text-[#53FC18]" />
                      <span>{channel}</span>
                    </div>
                  </div>
                  
                  {viewerCount !== null && (
                    <div className="flex flex-col items-center lg:items-end p-4 bg-red-500/5 rounded-2xl border border-red-500/10 min-w-[120px]">
                      <span className="text-[10px] font-black text-red-900/60 uppercase tracking-widest mb-1">Live Viewers</span>
                      <div className="flex items-center gap-2 text-red-500 font-bold">
                        <Eye className="w-4 h-4" />
                        <span>{viewerCount.toLocaleString()}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          {/* Decorative Corner Elements */}
          <div className="absolute top-6 right-6 flex gap-2">
            <div className="w-1 h-1 rounded-full bg-white/20" />
            <div className="w-1 h-1 rounded-full bg-white/20" />
            <div className="w-1 h-1 rounded-full bg-white/20" />
          </div>
        </motion.div>
      )}

      <div className={`${isTheaterMode ? 'w-full h-screen flex flex-col' : 'max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8'}`}>
        
        {/* Left Column: Controls & Configuration */}
        {!isTheaterMode && (
          <div className="space-y-6">
          <div className="bg-[#18181B] p-6 rounded-2xl border border-white/5 shadow-xl">
            <div className="flex items-center gap-2 mb-6">
              <Settings className="w-5 h-5 text-[#53FC18]" />
              <h2 className="text-xl font-bold uppercase tracking-wider">Setup</h2>
            </div>
            
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-end mb-1">
                  <label className="block text-xs font-semibold text-gray-400 uppercase">Kick Channel</label>
                  <a 
                    href={`https://kick.com/${channel}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[10px] text-[#53FC18] hover:underline uppercase font-bold"
                  >
                    View Channel
                  </a>
                </div>
                <input 
                  type="text" 
                  value={channel}
                  onChange={(e) => handleChannelChange(e.target.value)}
                  className="w-full bg-[#0E0E10] border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-[#53FC18] transition-colors"
                  placeholder="e.g. odablock or kick.com/odablock"
                />
              </div>
              
              <div className="grid grid-cols-1 gap-3 pt-2">
                <button 
                  onClick={connectToKick}
                  className={`flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${isConnected ? 'bg-[#53FC18]/20 text-[#53FC18] border border-[#53FC18]/50' : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'}`}
                >
                  {isConnected ? <CheckCircle2 className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {isConnected ? 'Connected to Chat' : 'Connect to Kick Chat'}
                </button>
                
                {isQuizRunning && (
                  <div className="grid grid-cols-1 gap-3">
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        onClick={togglePause}
                        className={`flex items-center justify-center gap-2 py-3 rounded-lg font-bold transition-all ${isPaused ? 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 border border-yellow-500/20' : 'bg-white/5 hover:bg-white/10 text-white border border-white/10'}`}
                      >
                        {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                        {isPaused ? 'Resume' : 'Pause'}
                      </button>
                      <button 
                        onClick={skipQuestion}
                        className="flex items-center justify-center gap-2 py-3 rounded-lg font-bold bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 transition-all"
                      >
                        <ChevronRight className="w-4 h-4" />
                        Skip
                      </button>
                    </div>
                    <button 
                      onClick={stopQuiz}
                      className="flex items-center justify-center gap-2 py-3 rounded-lg font-bold bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 transition-all"
                    >
                      <AlertCircle className="w-4 h-4" />
                      Stop Quiz
                    </button>
                  </div>
                )}

                <button 
                  onClick={() => setIsTheaterMode(true)}
                  className="flex items-center justify-center gap-2 py-3 rounded-lg font-bold bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-all"
                >
                  <Maximize2 className="w-4 h-4" />
                  Theater Mode
                </button>
              </div>

              {/* Timer Selection */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-gray-400 uppercase mb-2">Question Timer</label>
                <div className="grid grid-cols-3 gap-2">
                  {[15, 20, 30].map((duration) => (
                    <button
                      key={duration}
                      onClick={() => setTimerDuration(duration)}
                      className={`py-2 rounded-lg text-xs font-black transition-all border ${timerDuration === duration ? 'bg-[#53FC18] text-black border-[#53FC18]' : 'bg-[#0E0E10] text-gray-400 border-white/10 hover:border-white/20'}`}
                    >
                      {duration}s
                    </button>
                  ))}
                </div>
              </div>

              <button 
                disabled={!isConnected || questions.length === 0 || isQuizRunning}
                onClick={startQuiz}
                className="w-full bg-[#53FC18] hover:bg-[#46d614] disabled:bg-gray-700 disabled:cursor-not-allowed text-black font-black py-4 rounded-lg uppercase tracking-widest transition-all mt-2 shadow-[0_0_20px_rgba(83,252,24,0.2)]"
              >
                {isQuizRunning ? 'Quiz in Progress...' : 'Start Quiz'}
              </button>

              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="text-[10px] text-gray-500 uppercase font-black mb-2 tracking-widest">Instructions</p>
                <ul className="text-xs text-gray-400 space-y-2 list-disc pl-4">
                  <li>Users must type <span className="text-[#53FC18] font-bold">!quiz</span> in chat to join.</li>
                  <li>Answer by typing <span className="text-[#53FC18] font-bold">A, B, C, or D</span> (<span className="text-yellow-400 font-bold">5 points</span>).</li>
                  <li>Type the <span className="text-[#53FC18] font-bold">full answer text</span> for <span className="text-[#53FC18] font-bold">10 points</span>!</li>
                  <li>Only your <span className="text-red-400 font-bold">first attempt</span> counts per question.</li>
                  <li>Spamming multiple options will <span className="text-red-400 font-bold">not</span> work and will lock you out of the current question.</li>
                  <li>Fast correct answers earn you a spot on the leaderboard!</li>
                </ul>
              </div>
            </div>

            {error && (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg flex items-start gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}
          </div>

          {/* Stats Summary */}
          <div className="bg-[#18181B] p-6 rounded-2xl border border-white/5 shadow-xl">
            <div className="flex items-center gap-2 mb-4">
              <Users className="w-5 h-5 text-blue-400" />
              <h2 className="text-xl font-bold uppercase tracking-wider">Stats</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#0E0E10] p-4 rounded-xl border border-white/5">
                <p className="text-xs text-gray-500 uppercase font-bold">
                  {selectedCategory === 'All' ? 'Total Questions' : `${selectedCategory} Qs`}
                </p>
                <p className="text-2xl font-black">
                  {selectedCategory === 'All' 
                    ? questions.length 
                    : questions.filter(q => q.category === selectedCategory).length}
                </p>
              </div>
              <div className="bg-[#0E0E10] p-4 rounded-xl border border-white/5">
                <p className="text-xs text-gray-500 uppercase font-bold">Participants</p>
                <p className="text-2xl font-black">{Object.keys(leaderboard).length}</p>
              </div>
            </div>
          </div>

          {/* TOP 3 Podium */}
          <div className="bg-[#18181B] p-6 rounded-2xl border border-white/5 shadow-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#53FC18]/5 blur-3xl -mr-16 -mt-16 rounded-full" />
            
            <div className="flex items-center gap-2 mb-8 relative z-10">
              <Trophy className="w-5 h-5 text-yellow-500" />
              <h2 className="text-xl font-black uppercase tracking-wider italic">TOP 3</h2>
            </div>

            <div className="flex items-end justify-center gap-2 pt-12 pb-4 relative z-10 min-h-[220px]">
              {/* 2nd Place */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center flex-1"
              >
                <AnimatePresence mode="wait">
                  {sortedLeaderboard[1] ? (
                    <motion.div
                      key={sortedLeaderboard[1].username}
                      className="flex flex-col items-center mb-6 relative"
                    >
                      {/* Board */}
                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 100, delay: 0.5 }}
                        className="bg-white p-2 rounded-lg shadow-xl border-2 border-gray-300 mb-1 relative z-20"
                      >
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">2nd</div>
                        <div className="text-xs font-black text-black truncate w-20 text-center uppercase">{sortedLeaderboard[1].username}</div>
                        <div className="text-[10px] font-mono text-gray-500 text-center">{sortedLeaderboard[1].points} pts</div>
                        {/* Board Handle */}
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1 h-2 bg-gray-400" />
                      </motion.div>
                    </motion.div>
                  ) : (
                    <div className="h-16" />
                  )}
                </AnimatePresence>
                <motion.div 
                  initial={{ height: 0 }}
                  animate={{ height: 60 }}
                  className="w-full bg-gradient-to-t from-gray-800 to-gray-600 rounded-t-xl border-x border-t border-white/10 flex items-center justify-center relative shadow-lg"
                >
                  <div className="absolute -top-4 w-8 h-8 rounded-full bg-gray-700 border-2 border-gray-400 flex items-center justify-center shadow-xl">
                    <span className="text-xs font-black text-gray-200">2</span>
                  </div>
                </motion.div>
              </motion.div>

              {/* 1st Place */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex flex-col items-center flex-1"
              >
                <AnimatePresence mode="wait">
                  {sortedLeaderboard[0] ? (
                    <motion.div
                      key={sortedLeaderboard[0].username}
                      className="flex flex-col items-center mb-8 relative"
                    >
                      {/* Board */}
                      <motion.div
                        initial={{ y: 30, opacity: 0, scale: 0.5 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        transition={{ type: "spring", stiffness: 120, delay: 0.7 }}
                        className="bg-[#53FC18] p-3 rounded-lg shadow-[0_0_30px_rgba(83,252,24,0.4)] border-2 border-white mb-1 relative z-20"
                      >
                        <Trophy className="w-4 h-4 text-black mx-auto mb-1 animate-bounce" />
                        <div className="text-[10px] font-black text-black/60 uppercase tracking-widest text-center">Champion</div>
                        <div className="text-sm font-black text-black truncate w-24 text-center uppercase">{sortedLeaderboard[0].username}</div>
                        <div className="text-xs font-mono text-black font-bold text-center">{sortedLeaderboard[0].points} pts</div>
                        {/* Board Handle */}
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1.5 h-3 bg-white" />
                      </motion.div>
                    </motion.div>
                  ) : (
                    <div className="h-24" />
                  )}
                </AnimatePresence>
                <motion.div 
                  initial={{ height: 0 }}
                  animate={{ height: 100 }}
                  className="w-full bg-gradient-to-t from-yellow-900/40 to-yellow-500/40 rounded-t-xl border-x border-t border-yellow-500/30 flex items-center justify-center relative shadow-[0_0_30px_rgba(234,179,8,0.2)]"
                >
                  <div className="absolute -top-6 w-12 h-12 rounded-full bg-yellow-500 border-4 border-yellow-300 flex items-center justify-center shadow-[0_0_20px_rgba(234,179,8,0.5)]">
                    <span className="text-lg font-black text-yellow-900">1</span>
                  </div>
                </motion.div>
              </motion.div>

              {/* 3rd Place */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="flex flex-col items-center flex-1"
              >
                <AnimatePresence mode="wait">
                  {sortedLeaderboard[2] ? (
                    <motion.div
                      key={sortedLeaderboard[2].username}
                      className="flex flex-col items-center mb-6 relative"
                    >
                      {/* Board */}
                      <motion.div
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ type: "spring", stiffness: 100, delay: 0.9 }}
                        className="bg-orange-100 p-2 rounded-lg shadow-xl border-2 border-orange-300 mb-1 relative z-20"
                      >
                        <div className="text-[10px] font-black text-orange-400 uppercase tracking-widest text-center">3rd</div>
                        <div className="text-xs font-black text-orange-900 truncate w-20 text-center uppercase">{sortedLeaderboard[2].username}</div>
                        <div className="text-[10px] font-mono text-orange-700 text-center">{sortedLeaderboard[2].points} pts</div>
                        {/* Board Handle */}
                        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-1 h-2 bg-orange-400" />
                      </motion.div>
                    </motion.div>
                  ) : (
                    <div className="h-12" />
                  )}
                </AnimatePresence>
                <motion.div 
                  initial={{ height: 0 }}
                  animate={{ height: 45 }}
                  className="w-full bg-gradient-to-t from-orange-900/30 to-orange-700/30 rounded-t-xl border-x border-t border-orange-700/20 flex items-center justify-center relative shadow-lg"
                >
                  <div className="absolute -top-4 w-8 h-8 rounded-full bg-orange-800 border-2 border-orange-500 flex items-center justify-center shadow-xl">
                    <span className="text-xs font-black text-orange-200">3</span>
                  </div>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </div>
      )}

        {/* Middle Column: Active Quiz Area */}
        <div className={`${isTheaterMode ? 'flex-1 flex flex-col p-4 md:p-8 space-y-6' : 'lg:col-span-2 space-y-6'}`}>
          {/* Animated Quote Section */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentQuote}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="bg-gradient-to-r from-[#53FC18]/10 via-white/5 to-[#53FC18]/10 p-4 rounded-2xl border border-[#53FC18]/20 shadow-[0_0_20px_rgba(83,252,24,0.1)] text-center relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#53FC18]/50 to-transparent" />
              <div className="flex items-center justify-center gap-3">
                <BookOpen className="w-5 h-5 text-[#53FC18] animate-pulse" />
                <p className="text-lg md:text-xl font-black italic uppercase tracking-tight text-white drop-shadow-sm">
                  "{quotes[currentQuote]}"
                </p>
                <HelpCircle className="w-5 h-5 text-[#53FC18] animate-pulse" />
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Category Menu */}
          {!isTheaterMode && !isQuizRunning && availableCategories.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#18181B] p-4 rounded-2xl border border-white/5 shadow-xl relative group"
            >
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 mr-2 px-3 py-1 bg-white/5 rounded-lg border border-white/10 shrink-0">
                  <Tag className="w-4 h-4 text-[#53FC18]" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">Filter</span>
                </div>

                <div className="relative flex-1 flex items-center overflow-hidden">
                  {/* Left Arrow */}
                  <button 
                    onClick={() => scrollCategories('left')}
                    className="absolute left-0 z-20 p-1 text-gray-500 hover:text-[#53FC18] transition-colors"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>

                  <div 
                    ref={categoryScrollRef}
                    className="flex items-center gap-3 overflow-x-auto scrollbar-hide px-6"
                  >
                    <div className="flex items-center gap-3 min-w-max">
                      <button 
                        onClick={() => setSelectedCategory('All')}
                        className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${selectedCategory === 'All' ? 'bg-[#53FC18] text-black border-[#53FC18] shadow-[0_0_15px_rgba(83,252,24,0.3)]' : 'bg-[#0E0E10] text-gray-400 border-white/5 hover:border-white/20'}`}
                      >
                        Random / All
                      </button>
                      {availableCategories.map(cat => (
                        <button 
                          key={cat}
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${selectedCategory === cat ? 'bg-[#53FC18] text-black border-[#53FC18] shadow-[0_0_15px_rgba(83,252,24,0.3)]' : 'bg-[#0E0E10] text-gray-400 border-white/5 hover:border-white/20'}`}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Right Arrow */}
                  <button 
                    onClick={() => scrollCategories('right')}
                    className="absolute right-0 z-20 p-1 text-gray-500 hover:text-[#53FC18] transition-colors"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          <div className={`${isTheaterMode ? 'flex-1' : ''} bg-[#18181B] p-8 rounded-3xl border border-white/5 shadow-2xl min-h-[400px] flex flex-col items-center justify-center relative overflow-hidden`}>
            {/* Background Decorative Element */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#53FC18]/5 blur-[100px] -mr-32 -mt-32 rounded-full" />
            
            <AnimatePresence mode="wait">
              {!isQuizRunning ? (
                <motion.div 
                  key="idle"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.1 }}
                  className="text-center space-y-4 z-10"
                >
                  <Trophy className="w-20 h-20 text-[#53FC18] mx-auto mb-4 opacity-50" />
                  <h1 className="text-4xl font-black uppercase italic tracking-tighter">Ready to Start?</h1>
                  <p className="text-gray-400 max-w-md mx-auto">
                    {selectedCategory === 'All' 
                      ? "Connect to Kick chat and fetch your questions to begin the ultimate interactive quiz experience."
                      : `You've selected the ${selectedCategory} category. Get ready for a specialized challenge!`}
                  </p>
                </motion.div>
              ) : currentQuestionIndex < quizQuestions.length ? (
                <motion.div 
                  key={currentQuestionIndex}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="w-full text-center space-y-8 z-10"
                >
                  <div className="space-y-2">
                    <div className="flex flex-col items-center gap-2">
                      <div className="inline-block px-4 py-1 bg-[#53FC18]/10 border border-[#53FC18]/30 rounded-full text-[#53FC18] text-xs font-bold uppercase tracking-widest">
                        Question {currentQuestionIndex + 1} of {quizQuestions.length}
                      </div>
                      {isTranslating && (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex items-center gap-2 text-[10px] text-gray-500 font-black uppercase tracking-widest"
                        >
                          <div className="w-2 h-2 border border-gray-500 border-t-transparent rounded-full animate-spin" />
                          Translating to Arabic...
                        </motion.div>
                      )}
                    </div>
                    
                    <div className="flex items-center justify-center gap-3 pt-4">
                      <Tag className="w-8 h-8 text-[#53FC18] drop-shadow-[0_0_10px_rgba(83,252,24,0.4)]" />
                      <span className="text-3xl md:text-4xl font-black uppercase italic tracking-tighter text-white drop-shadow-sm">
                        {quizQuestions[currentQuestionIndex].category}
                      </span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <h2 className="text-4xl md:text-5xl font-black leading-tight tracking-tight pt-2">
                      {quizQuestions[currentQuestionIndex].question}
                    </h2>
                    {quizQuestions[currentQuestionIndex].arabicQuestion && (
                      <h2 className="text-3xl md:text-4xl font-arabic font-bold leading-tight tracking-tight text-[#53FC18] dir-rtl text-right">
                        {quizQuestions[currentQuestionIndex].arabicQuestion}
                      </h2>
                    )}
                  </div>

                  {/* Options Display */}
                  {quizQuestions[currentQuestionIndex].options && (
                    <div className="space-y-4 max-w-4xl mx-auto w-full pt-4">
                      <div className="flex items-center justify-center gap-2 mb-2">
                        <div className="h-px bg-white/10 flex-1" />
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500">Choices</span>
                        <div className="h-px bg-white/10 flex-1" />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {quizQuestions[currentQuestionIndex].options.map((option, idx) => {
                          const label = String.fromCharCode(65 + idx); // A, B, C, D...
                          return (
                            <motion.div
                              key={idx}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: idx * 0.1 }}
                              className="flex items-center gap-4 p-5 bg-[#18181B] border border-white/5 rounded-2xl hover:border-[#53FC18]/30 hover:bg-[#1C1C21] transition-all group shadow-xl"
                            >
                              <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center bg-[#0E0E10] border border-white/10 rounded-xl text-[#53FC18] font-black group-hover:bg-[#53FC18] group-hover:text-black transition-all shadow-inner">
                                {label}
                              </div>
                              <div className="flex flex-col text-left">
                                <div className="text-xl font-bold text-gray-100 uppercase tracking-tight leading-tight">
                                  {option}
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {quizQuestions[currentQuestionIndex].image && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="relative max-w-2xl mx-auto rounded-2xl overflow-hidden border border-white/10 shadow-2xl"
                    >
                      <img 
                        src={quizQuestions[currentQuestionIndex].image} 
                        alt="Question visual" 
                        className="w-full h-auto max-h-[300px] object-contain bg-black/20"
                        referrerPolicy="no-referrer"
                      />
                    </motion.div>
                  )}

                  <div className="flex flex-col items-center gap-4">
                    <div className="w-full max-w-md h-4 bg-white/5 rounded-full overflow-hidden relative border border-white/5 shadow-inner">
                      <motion.div 
                        initial={{ width: "100%" }}
                        animate={{ 
                          width: isReadingTime ? "100%" : `${(timeLeft / timerDuration) * 100}%`,
                          backgroundColor: isReadingTime ? "#3b82f6" : (timeLeft <= 5 ? "#ef4444" : "#53FC18")
                        }}
                        transition={{ duration: isReadingTime ? 0.3 : 1, ease: "linear" }}
                        className="h-full"
                        style={{
                          boxShadow: isReadingTime 
                            ? "0 0 15px rgba(59, 130, 246, 0.5)"
                            : (timeLeft <= 5 
                              ? "0 0 15px rgba(239, 68, 68, 0.5)" 
                              : "0 0 15px rgba(83, 252, 24, 0.3)")
                        }}
                      />
                    </div>
                    <div className="flex flex-col items-center">
                      {isReadingTime ? (
                        <motion.p 
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-2xl font-black text-blue-400 uppercase tracking-widest animate-pulse"
                        >
                          Read Question...
                        </motion.p>
                      ) : (
                        <p className={`text-3xl font-mono font-black transition-colors duration-300 ${timeLeft <= 5 ? 'text-red-500 animate-pulse' : 'text-[#53FC18]'}`}>
                          {timeLeft}s
                        </p>
                      )}
                    </div>
                  </div>

                  <AnimatePresence>
                    {isTransitioning && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.1 }}
                        className="absolute inset-0 bg-[#0E0E10]/90 backdrop-blur-md z-30 flex flex-col items-center justify-center p-8 text-center"
                      >
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                          className="w-12 h-12 border-4 border-[#53FC18] border-t-transparent rounded-full mb-6"
                        />
                        <h3 className="text-3xl font-black uppercase italic tracking-tighter mb-2">
                          {currentQuestionIndex + 1 < quizQuestions.length ? `Next Question ${currentQuestionIndex + 2}` : "Final Results"}
                        </h3>
                        <p className="text-gray-400 mb-8 max-w-xs">
                          {currentQuestionIndex + 1 < quizQuestions.length ? "Get ready for the next challenge..." : "Calculating final scores..."}
                        </p>
                        
                        <div className="w-full max-w-md space-y-4">
                          <div className="p-6 bg-white/5 rounded-2xl border border-white/10 shadow-2xl">
                            <p className="text-xs text-gray-500 uppercase font-bold mb-2 tracking-widest">Correct Answer</p>
                            <div className="space-y-2">
                              <p className="text-3xl font-black text-[#53FC18] uppercase tracking-tight">
                                {quizQuestions[currentQuestionIndex].answer}
                              </p>
                            </div>
                          </div>

                          {/* Round Winners List */}
                          <div className="bg-black/40 rounded-2xl p-4 border border-white/5">
                            <p className="text-[10px] text-gray-500 uppercase font-bold mb-3 tracking-widest">Correct This Round</p>
                            <div className="space-y-2">
                              {(Object.values(leaderboard) as UserStats[])
                                .filter(u => u.lastAnswerTimeStr !== '-' && u.lastAnswerTimeStr !== '')
                                .slice(0, 5)
                                .map((winner, i) => (
                                  <div key={winner.username} className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[#53FC18] font-bold">#{i + 1}</span>
                                      <span className="font-medium">{winner.username}</span>
                                    </div>
                                    <span className="text-blue-400 font-mono">{winner.lastAnswerTimeStr}</span>
                                  </div>
                                ))}
                              {(Object.values(leaderboard) as UserStats[]).filter(u => u.lastAnswerTimeStr !== '-' && u.lastAnswerTimeStr !== '').length === 0 && (
                                <p className="text-gray-600 italic text-xs">No one answered correctly</p>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <motion.div 
                  key="finished"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center space-y-4 z-10"
                >
                  <CheckCircle2 className="w-20 h-20 text-[#53FC18] mx-auto mb-4" />
                  <h1 className="text-4xl font-black uppercase italic tracking-tighter">Quiz Finished!</h1>
                  <p className="text-gray-400">Check the leaderboard to see who won.</p>
                  <button 
                    onClick={() => setIsQuizRunning(false)}
                    className="mt-4 px-8 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-bold transition-all"
                  >
                    Reset View
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className={`grid grid-cols-1 ${isTheaterMode ? '' : 'md:grid-cols-2'} gap-6`}>
            {/* Leaderboard Table */}
            <div className={`${isTheaterMode ? 'max-h-[300px] overflow-y-auto' : ''} bg-[#18181B] rounded-2xl border border-white/5 shadow-xl overflow-hidden`}>
              <div className="p-6 border-bottom border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-500" />
                  <h2 className="text-lg font-bold uppercase tracking-wider">Leaderboard</h2>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[#0E0E10] text-xs text-gray-500 uppercase font-bold">
                    <tr>
                      <th className="px-6 py-3">User</th>
                      <th className="px-6 py-3 text-right">Points</th>
                      <th className="px-6 py-3 text-right">Time of Answer (Morocco)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {sortedLeaderboard.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-6 py-8 text-center text-gray-500 italic">No participants yet</td>
                      </tr>
                    ) : (
                      sortedLeaderboard.map((user: UserStats, idx: number) => (
                        <tr key={user.username} className="hover:bg-white/5 transition-colors">
                          <td className="px-6 py-4 flex items-center gap-3">
                            <span className={`w-6 text-xs font-bold ${idx < 3 ? 'text-[#53FC18]' : 'text-gray-600'}`}>#{idx + 1}</span>
                            <span className="font-bold">{user.username}</span>
                          </td>
                          <td className="px-6 py-4 text-right font-mono font-bold text-[#53FC18]">{user.points}</td>
                          <td className="px-6 py-4 text-right font-mono text-gray-400">{user.lastAnswerTimeStr}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Chat Log */}
            {!isTheaterMode && (
              <div className="bg-[#18181B] rounded-2xl border border-white/5 shadow-xl flex flex-col h-[400px]">
              <div className="p-6 border-bottom border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-[#53FC18]" />
                  <h2 className="text-lg font-bold uppercase tracking-wider">Live Chat</h2>
                </div>
                <button 
                  onClick={() => setMessages([])}
                  className="text-[10px] font-black uppercase tracking-widest text-gray-500 hover:text-red-500 transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-hide">
                {messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-600 italic text-sm">
                    Waiting for messages...
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div key={msg.id} className="text-sm group">
                      <span className="font-bold text-[#53FC18] mr-2">{msg.username}:</span>
                      <span className="text-gray-300 break-words">{msg.content}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          </div>

          {/* Documentation & Q&A Section */}
          {!isTheaterMode && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-7xl mx-auto mt-12 bg-[#18181B] rounded-3xl border border-white/5 shadow-2xl overflow-hidden"
            >
              <div className="flex border-b border-white/5">
                <button 
                  onClick={() => setFooterTab('docs')}
                  className={`flex-1 py-4 font-black uppercase tracking-widest text-sm transition-all ${footerTab === 'docs' ? 'bg-[#53FC18] text-black' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                >
                  How to Use
                </button>
                <button 
                  onClick={() => setFooterTab('qa')}
                  className={`flex-1 py-4 font-black uppercase tracking-widest text-sm transition-all ${footerTab === 'qa' ? 'bg-[#53FC18] text-black' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                >
                  Q&A
                </button>
              </div>

              <div className="p-8">
                {footerTab === 'docs' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-6">
                      <h3 className="text-xl font-black uppercase italic text-[#53FC18]">Step-by-Step Guide</h3>
                      <div className="space-y-4">
                        {[
                          { step: "01", title: "Connect to Kick", desc: "Enter your Kick channel name in the input field at the top and click 'Connect'. Make sure you are live!" },
                          { step: "02", title: "Pick a Category", desc: "Browse through the available quiz categories and select one that fits your stream's vibe." },
                          { step: "03", title: "Start the Quiz", desc: "Click the 'Start Quiz' button. The first question will appear on screen for your viewers." },
                          { step: "04", title: "Chat Participation", desc: "Your viewers participate by typing A, B, C, or D in your Kick chat. Only their first guess counts!" },
                          { step: "05", title: "Pause & Resume", desc: "Need a break? Use the 'Pause Quiz' button to freeze the timer and chat processing at any time." },
                          { step: "06", title: "Win & Rank", desc: "The leaderboard updates instantly. Correct answers earn points. Speed and accuracy are key!" }
                        ].map((item) => (
                          <div key={item.step} className="flex gap-4 group">
                            <span className="text-2xl font-black text-white/10 group-hover:text-[#53FC18]/30 transition-colors">{item.step}</span>
                            <div>
                              <h4 className="font-bold text-white uppercase tracking-tight">{item.title}</h4>
                              <p className="text-sm text-gray-500 leading-relaxed">{item.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="bg-[#0E0E10] rounded-2xl p-6 border border-white/5 flex flex-col justify-center items-center text-center space-y-4">
                      <div className="w-16 h-16 rounded-full bg-[#53FC18]/10 flex items-center justify-center">
                        <BookOpen className="w-8 h-8 text-[#53FC18]" />
                      </div>
                      <h3 className="text-lg font-bold uppercase tracking-wider">Pro Tip</h3>
                      <p className="text-sm text-gray-400">
                        Use "Theater Mode" (bottom right button) to hide the UI and focus entirely on the quiz during your stream. It's perfect for OBS window capture!
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[
                      { q: "How are points calculated?", a: "Points are awarded for correct answers. Each correct answer gives you 10 points. Speed and accuracy are key to climbing the ranks!" },
                      { q: "Can viewers change their answer?", a: "No. Only the first valid answer (A, B, C, or D) from each user per question is counted. If a user answers incorrectly first, they cannot try again for that question." },
                      { q: "What happens if I pause the quiz?", a: "The timer stops and the chat will not process any new answers until you resume. This is perfect for taking a quick break or discussing a question." },
                      { q: "Does the progress bar pause too?", a: "Yes! When you pause the quiz, the visual timer bar freezes exactly where it is, so you don't lose any time." },
                      { q: "Is this an official Kick app?", a: "No, this is a community-made tool by Graphiicc designed specifically for Kick streamers to engage their audience." },
                      { q: "How many questions per quiz?", a: "Each quiz typically consists of 10-15 high-quality questions tailored to the selected category." }
                    ].map((item, i) => (
                      <div key={i} className="p-6 rounded-2xl bg-white/5 border border-white/5 hover:border-[#53FC18]/30 transition-all group">
                        <h4 className="font-bold text-[#53FC18] mb-2 uppercase tracking-tight flex items-center gap-2">
                          <HelpCircle className="w-4 h-4" />
                          {item.q}
                        </h4>
                        <p className="text-sm text-gray-400 leading-relaxed group-hover:text-gray-300 transition-colors">{item.a}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* Footer Signature */}
      {!isTheaterMode && (
        <motion.footer 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 }}
        className="max-w-7xl mx-auto mt-16 pb-8 text-center"
      >
        <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent mb-8" />
        <motion.div 
          className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm shadow-xl"
          whileHover={{ scale: 1.05, backgroundColor: "rgba(255,255,255,0.08)" }}
        >
          <span className="text-sm font-medium text-gray-400 uppercase tracking-[0.2em]">Created with</span>
          <motion.div
            animate={{ 
              scale: [1, 1.2, 1],
              color: ["#9ca3af", "#ef4444", "#9ca3af"]
            }}
            transition={{ 
              duration: 1.5, 
              repeat: Infinity,
              ease: "easeInOut"
            }}
          >
            <Heart className="w-4 h-4 fill-current" />
          </motion.div>
          <span className="text-sm font-medium text-gray-400 uppercase tracking-[0.2em]">by</span>
          <motion.span 
            className="text-sm font-black text-white uppercase tracking-[0.3em] italic"
            animate={{ 
              textShadow: [
                "0 0 0px rgba(83,252,24,0)",
                "0 0 10px rgba(83,252,24,0.5)",
                "0 0 0px rgba(83,252,24,0)"
              ]
            }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            Graphiicc
          </motion.span>
        </motion.div>
      </motion.footer>
      )}
    </div>
  );
}
