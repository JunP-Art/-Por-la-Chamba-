/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Fuel, Timer, Gauge, Trophy, RotateCcw, Play, Home } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import bugatySvg from './assets/Bugaty.svg';
import escarabajoSvg from './assets/escarabajo.svg';
import bolidoSvg from './assets/bolido.svg';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Constants ---
const CANVAS_WIDTH = 400;
const CANVAS_HEIGHT = 600;
const ROAD_WIDTH = 240;
const PLAYER_WIDTH = 30;
const PLAYER_HEIGHT = 50;
const INITIAL_FUEL = 100;
const FUEL_CONSUMPTION_BASE = 0.01;
const FUEL_RECOVERY = 20;
const MAX_SPEED_INITIAL = 8;
const MAX_SPEED_LIMIT = 17.5; // 350 km/h (17.5 * 20)
const SPEED_INCREMENT_INTERVAL = 10; // seconds
const SPEED_INCREMENT_AMOUNT = 1; // 1 unit = 20 km/h (since 1 unit * 20 = 20 km/h)
const ACCELERATION = 0.1;
const FRICTION = 0.05;
const CURVE_INTENSITY = 2.5;
const RAMP_INTERVAL = 7000; // 70 "km"
const INITIAL_LIVES = 7;
const TOTAL_GAME_TIME = 360; // 6 minutes limit
// Target distance calculation:
// Approx speed 14 units/frame * 60 frames/sec * 240 sec (4 mins) = 201,600
const TARGET_DISTANCE = 200000; 

type GameState = 'START' | 'PLAYING' | 'GAMEOVER' | 'FINISHED';
type MenuState = 'MAIN' | 'MAP' | 'NARRATIVE';

interface Obstacle {
  id: number;
  relativeX: number; // Offset from road center
  y: number;
  type: 'CAR' | 'FAST_CAR' | 'FUEL' | 'OIL' | 'RAMP' | 'HOLE';
  speed: number;
}

export default function App() {
  const [gameState, setGameState] = useState<GameState>('START');
  const [menuState, setMenuState] = useState<MenuState>('MAIN');
  const [score, setScore] = useState(0);
  const [fuel, setFuel] = useState(INITIAL_FUEL);
  const [lives, setLives] = useState(INITIAL_LIVES);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [maxSpeed, setMaxSpeed] = useState(MAX_SPEED_INITIAL);
  const [distance, setDistance] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const [codeTab, setCodeTab] = useState<'HTML' | 'CSS'>('HTML');
  
  // Game refs for high-frequency updates
  const stateRef = useRef({
    playerX: CANVAS_WIDTH / 2,
    playerY: CANVAS_HEIGHT - 100,
    speed: 0,
    maxSpeed: MAX_SPEED_INITIAL,
    fuel: INITIAL_FUEL,
    lives: INITIAL_LIVES,
    distance: 0,
    time: 0,
    obstacles: [] as Obstacle[],
    roadOffset: 0,
    roadHistory: Array(Math.ceil(CANVAS_HEIGHT / 10) + 1).fill(0) as number[], // History of offsets
    curve: 0,
    targetCurve: 0,
    curveTimer: 0,
    keys: { w: false, a: false, s: false, d: false },
    lastTime: 0,
    obstacleIdCounter: 0,
    nextRampDistance: RAMP_INTERVAL,
    isJumping: false,
    jumpTimer: 0,
    slideTimer: 0,
    slideDirection: 0,
    bounceTimer: 0,
    bounceDirection: 0,
    lastSpeedIncreaseTime: 0,
  });

  const resetGame = useCallback(() => {
    stateRef.current = {
      playerX: CANVAS_WIDTH / 2,
      playerY: CANVAS_HEIGHT - 100,
      speed: 0,
      maxSpeed: MAX_SPEED_INITIAL,
      fuel: INITIAL_FUEL,
      lives: INITIAL_LIVES,
      distance: 0,
      time: 0,
      obstacles: [],
      roadOffset: 0,
      roadHistory: Array(Math.ceil(CANVAS_HEIGHT / 10) + 1).fill(0),
      curve: 0,
      targetCurve: 0,
      curveTimer: 0,
      keys: { w: false, a: false, s: false, d: false },
      lastTime: performance.now(),
      obstacleIdCounter: 0,
      nextRampDistance: RAMP_INTERVAL,
      isJumping: false,
      jumpTimer: 0,
      slideTimer: 0,
      slideDirection: 0,
      bounceTimer: 0,
      bounceDirection: 0,
      lastSpeedIncreaseTime: 0,
    };
    setGameState('PLAYING');
    setFuel(INITIAL_FUEL);
    setLives(INITIAL_LIVES);
    setTime(0);
    setScore(0);
    setDistance(0);
    setSpeed(0);
    setMaxSpeed(MAX_SPEED_INITIAL);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key in stateRef.current.keys) {
        stateRef.current.keys[key as keyof typeof stateRef.current.keys] = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key in stateRef.current.keys) {
        stateRef.current.keys[key as keyof typeof stateRef.current.keys] = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    let animationFrameId: number;

    const update = (t: number) => {
      const dt = (t - stateRef.current.lastTime) / 16.67; // Normalize to ~60fps
      stateRef.current.lastTime = t;

      const state = stateRef.current;

      // 1. Handle Input & Speed
      // Speed increase every 10 seconds (+20 km/h)
      if (state.time - state.lastSpeedIncreaseTime >= SPEED_INCREMENT_INTERVAL) {
        if (state.maxSpeed < MAX_SPEED_LIMIT) {
          state.maxSpeed = Math.min(state.maxSpeed + SPEED_INCREMENT_AMOUNT, MAX_SPEED_LIMIT);
          state.lastSpeedIncreaseTime = state.time;
        }
      }

      if (state.keys.w) {
        state.speed = Math.min(state.speed + ACCELERATION * dt, state.maxSpeed);
      } else if (state.keys.s) {
        // Instant brake
        state.speed = Math.max(state.speed - ACCELERATION * 10 * dt, 0);
        if (state.speed < 1) state.speed = 0;
      } else {
        state.speed = Math.max(state.speed - FRICTION * dt, 0);
      }

      // Handle sliding
      if (state.slideTimer > 0) {
        state.slideTimer -= dt;
        state.playerX += state.slideDirection * 2 * dt;
      }

      // Handle bouncing from walls
      if (state.bounceTimer > 0) {
        state.bounceTimer -= dt;
        state.playerX += state.bounceDirection * 6 * dt; // Stronger push
      }

      if (state.keys.a) {
        state.playerX -= (state.slideTimer > 0 ? 1 : 4) * dt;
      }
      if (state.keys.d) {
        state.playerX += (state.slideTimer > 0 ? 1 : 4) * dt;
      }

      // 2. Road & Curves
      state.curveTimer -= dt;
      if (state.curveTimer <= 0) {
        state.targetCurve = (Math.random() - 0.5) * CURVE_INTENSITY;
        state.curveTimer = 100 + Math.random() * 200;
      }
      // Smoothly transition curve
      state.curve += (state.targetCurve - state.curve) * 0.02 * dt;
      
      // The road offset shifts based on curve and speed
      const moveStep = state.speed * dt;
      state.roadOffset += state.curve * (state.speed / state.maxSpeed) * dt;
      
      // Clamp road offset to keep highway visible
      const maxOffset = (CANVAS_WIDTH - ROAD_WIDTH) / 2 - 20;
      state.roadOffset = Math.max(-maxOffset, Math.min(maxOffset, state.roadOffset));
      
      // Update road history (shift based on distance)
      // We use a simple approach: every frame we shift the history slightly
      // but to make it accurate to speed, we should shift it based on distance.
      // For simplicity in this 2D view, we'll just update the top and shift.
      const segmentHeight = 10;
      const pixelsPerShift = segmentHeight;
      
      // We track how many pixels we've moved to know when to shift the history
      if (!state.hasOwnProperty('distanceToShift')) (state as any).distanceToShift = 0;
      (state as any).distanceToShift += moveStep;
      
      while ((state as any).distanceToShift >= pixelsPerShift) {
        state.roadHistory.unshift(state.roadOffset);
        state.roadHistory.pop();
        (state as any).distanceToShift -= pixelsPerShift;
      }
      
      // 3. Fuel & Time
      if (state.speed > 0) {
        state.fuel -= (FUEL_CONSUMPTION_BASE + (state.speed / state.maxSpeed) * 0.1) * dt;
      }
      state.time += dt / 60;
      state.distance += state.speed * dt;

      // Win Condition: Distance
      if (state.distance >= TARGET_DISTANCE) {
        setGameState('FINISHED');
        return;
      }

      // Lose Condition: Time or Fuel/Lives
      if (state.time >= TOTAL_GAME_TIME) {
        setGameState('GAMEOVER'); // Time out
        return;
      }

      if (state.fuel <= 0 || state.lives <= 0) {
        setGameState('GAMEOVER');
        return;
      }

      // 4. Obstacles & Ramps
      if (state.distance >= state.nextRampDistance) {
        state.nextRampDistance += RAMP_INTERVAL;
        const rampX = Math.random() * (ROAD_WIDTH - 60) - (ROAD_WIDTH - 60) / 2;
        state.obstacles.push({
          id: state.obstacleIdCounter++,
          relativeX: rampX,
          y: -50,
          type: 'RAMP',
          speed: 0,
        });
        state.obstacles.push({
          id: state.obstacleIdCounter++,
          relativeX: rampX,
          y: -150,
          type: 'HOLE',
          speed: 0,
        });
      }

      if (Math.random() < 0.025 * dt) {
        const rand = Math.random();
        let type: 'FUEL' | 'CAR' | 'FAST_CAR' | 'OIL' = 'CAR';
        if (rand < 0.6) type = 'FUEL'; // 60% fuel
        else if (rand < 0.75) type = 'OIL'; // 15% oil
        else if (rand < 0.9) type = 'CAR'; // 15% normal car
        else type = 'FAST_CAR'; // 10% fast car

        let carSpeed = 0;
        let spawnY = -50;
        if (type === 'CAR') carSpeed = 2 + Math.random() * 2;
        if (type === 'FAST_CAR') {
          // Oncoming traffic: negative speed so it moves down the screen rapidly
          carSpeed = -(5 + Math.random() * 2.5);
          spawnY = -150; // Spawn from top
        }

        state.obstacles.push({
          id: state.obstacleIdCounter++,
          relativeX: Math.random() * (ROAD_WIDTH - 30) - (ROAD_WIDTH - 30) / 2,
          y: spawnY,
          type,
          speed: carSpeed,
        });
      }

      if (state.isJumping) {
        state.jumpTimer -= dt;
        if (state.jumpTimer <= 0) {
          state.isJumping = false;
        }
      }

      state.obstacles.forEach(obs => {
        obs.y += (state.speed - obs.speed) * dt;
        
        // Fast Car AI: Dodge other cars, zig-zag, and avoid player
        if (obs.type === 'FAST_CAR') {
          // Zig-zag movement
          obs.relativeX += Math.sin(state.time * 0.1) * 2 * dt;

          // Dodge other obstacles
          state.obstacles.forEach(other => {
            if (other.id !== obs.id && (other.type === 'CAR' || other.type === 'FAST_CAR')) {
              const dy = other.y - obs.y; // distance ahead (since fast car moves down, higher Y is ahead)
              const dx = obs.relativeX - other.relativeX;
              
              if (dy > 0 && dy < 150 && Math.abs(dx) < 40) {
                obs.relativeX += (dx > 0 ? 3 : -3) * dt;
              }
            }
          });

          // Avoid player (don't crash, just scare)
          const dyPlayer = state.playerY - obs.y;
          // Get road offset at player's Y to calculate player's relative X
          const pIdx = Math.max(0, Math.min(state.roadHistory.length - 1, Math.floor(state.playerY / 10)));
          const rOffsetP = state.roadHistory[pIdx] || state.roadOffset;
          const playerRelativeX = state.playerX - (CANVAS_WIDTH / 2) - rOffsetP;
          const dxPlayer = obs.relativeX - playerRelativeX;

          if (dyPlayer > 0 && dyPlayer < 150 && Math.abs(dxPlayer) < 50) {
            // Steer away from player
            obs.relativeX += (dxPlayer > 0 ? 4 : -4) * dt;
          }

          // Clamp to road
          const limit = (ROAD_WIDTH - 30) / 2;
          obs.relativeX = Math.max(-limit, Math.min(limit, obs.relativeX));
        }

        // Get road offset at obstacle's Y position
        const obsHistoryIndex = Math.max(0, Math.min(state.roadHistory.length - 1, Math.floor(obs.y / 10)));
        const roadOffsetAtObs = state.roadHistory[obsHistoryIndex] || state.roadOffset;
        
        // Determine obstacle screen position and size for collision
        let obsW = PLAYER_WIDTH;
        let obsH = PLAYER_HEIGHT;
        let obsScreenX = (CANVAS_WIDTH / 2) + roadOffsetAtObs + obs.relativeX;

        if (obs.type === 'FUEL') { obsW = 25; obsH = 25; }
        else if (obs.type === 'OIL') { obsW = 40; obsH = 20; }
        else if (obs.type === 'RAMP') { obsW = 80; obsH = 40; } // Larger ramp hit box
        else if (obs.type === 'HOLE') { 
          obsW = ROAD_WIDTH; 
          obsH = 40; 
          obsScreenX = (CANVAS_WIDTH - ROAD_WIDTH) / 2 + roadOffsetAtObs;
        }

        // Collision Detection (Center-to-Center)
        const playerCenterX = state.playerX + PLAYER_WIDTH / 2;
        const playerCenterY = state.playerY + PLAYER_HEIGHT / 2;
        const obsCenterX = obsScreenX + obsW / 2;
        const obsCenterY = obs.y + obsH / 2;

        const dx = Math.abs(playerCenterX - obsCenterX);
        const dy = Math.abs(playerCenterY - obsCenterY);

        if (dx < (PLAYER_WIDTH + obsW) / 2 && dy < (PLAYER_HEIGHT + obsH) / 2) {
          if (obs.type === 'FUEL') {
            state.fuel = Math.min(state.fuel + FUEL_RECOVERY, 100);
            obs.y = CANVAS_HEIGHT + 100; // Remove
          } else if (obs.type === 'CAR' || obs.type === 'FAST_CAR') {
            if (!state.isJumping) {
              state.speed *= 0.5;
              state.lives -= 1;
              obs.y = CANVAS_HEIGHT + 100; // Remove
            }
          } else if (obs.type === 'OIL') {
            if (!state.isJumping) {
              state.speed *= 0.5;
              state.slideTimer = 40; // Slide for 40 frames
              state.slideDirection = Math.random() > 0.5 ? 1 : -1;
              obs.y = CANVAS_HEIGHT + 100; // Remove
            }
          } else if (obs.type === 'RAMP') {
            state.isJumping = true;
            state.jumpTimer = 60; // Jump duration
            obs.y = CANVAS_HEIGHT + 100;
          } else if (obs.type === 'HOLE') {
            if (!state.isJumping) {
              state.speed = 0;
              state.lives -= 1;
              obs.y = CANVAS_HEIGHT + 100;
            }
          }
        }
      });

      state.obstacles = state.obstacles.filter(obs => obs.y < CANVAS_HEIGHT + 100 && obs.y > -150);

      // 5. Constraints (Barriers)
      // Get road offset at player's Y position
      const playerHistoryIndex = Math.floor(state.playerY / 10);
      const roadOffsetAtPlayer = state.roadHistory[playerHistoryIndex] || state.roadOffset;
      const roadLeft = (CANVAS_WIDTH - ROAD_WIDTH) / 2 + roadOffsetAtPlayer;
      const roadRight = roadLeft + ROAD_WIDTH;
      
      if (state.playerX < roadLeft || state.playerX > roadRight - PLAYER_WIDTH) {
        if (!state.isJumping && state.bounceTimer <= 0) {
          state.speed *= 0.5;
          state.lives -= 1;
          
          // Trigger bounce towards center
          state.bounceTimer = 20; // 20 frames of bounce
          const roadCenter = roadLeft + ROAD_WIDTH / 2 - PLAYER_WIDTH / 2;
          state.bounceDirection = state.playerX < roadCenter ? 1 : -1;
          
          // Small initial push to get away from the wall immediately
          state.playerX += state.bounceDirection * 10;
        } else if (state.isJumping) {
          // If jumping, just slow down slightly if off road (unlikely but possible)
          state.speed *= 0.99;
        }
      }

      // Sync React state (throttled for performance)
      if (Math.floor(t / 100) !== Math.floor((t - 16) / 100)) {
        setFuel(Math.max(0, state.fuel));
        setLives(state.lives);
        setTime(state.time);
        setDistance(state.distance);
        setSpeed(state.speed);
        setMaxSpeed(state.maxSpeed);
        setScore(Math.floor(state.distance / 10));
      }

      draw();
      animationFrameId = requestAnimationFrame(update);
    };

    const draw = () => {
      // No-op for DOM rendering, state is synced to React
    };

    animationFrameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState]);

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans flex flex-col items-center justify-center p-4 overflow-hidden">
      <div className="flex flex-col lg:flex-row gap-8 items-stretch">
        {/* Main Game Container */}
        <div className="relative group">
          {/* Decorative Borders */}
          <div className="absolute -inset-1 bg-gradient-to-b from-blue-500 to-emerald-500 rounded-lg blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
          
          <div className="relative bg-zinc-900 rounded-lg overflow-hidden border border-white/10 shadow-2xl w-[400px] h-[600px]">
            {/* DOM-based Game World */}
            <div className="absolute inset-0 bg-[#2d5a27] overflow-hidden">
              {/* Road Segments */}
              {stateRef.current.roadHistory.map((offset, i) => {
                const y = i * 10;
                const roadLeft = (CANVAS_WIDTH - ROAD_WIDTH) / 2 + offset;
                return (
                  <div 
                    key={i} 
                    className="absolute w-full h-[11px]" 
                    style={{ top: y }}
                  >
                    {/* Asphalt */}
                    <div 
                      className="absolute h-full bg-[#333]" 
                      style={{ left: roadLeft, width: ROAD_WIDTH }}
                    />
                    {/* Center Line */}
                    <div 
                      className="absolute h-full w-[2px] bg-white opacity-50" 
                      style={{ 
                        left: roadLeft + ROAD_WIDTH / 2 - 1,
                        display: (Math.floor((y + distance) / 40) % 2 === 0) ? 'block' : 'none'
                      }}
                    />
                    {/* Barriers */}
                    <div className="absolute h-full w-2 bg-red-500" style={{ left: roadLeft - 8 }} />
                    <div className="absolute h-full w-2 bg-red-500" style={{ left: roadLeft + ROAD_WIDTH }} />
                  </div>
                );
              })}

              {/* Obstacles */}
              {stateRef.current.obstacles.map((obs) => {
                const obsHistoryIndex = Math.max(0, Math.min(stateRef.current.roadHistory.length - 1, Math.floor(obs.y / 10)));
                const roadOffsetAtObs = stateRef.current.roadHistory[obsHistoryIndex] || stateRef.current.roadOffset;
                const obsScreenX = (CANVAS_WIDTH / 2) + roadOffsetAtObs + obs.relativeX;

                return (
                  <div 
                    key={obs.id}
                    className="absolute transition-transform duration-75"
                    style={{ 
                      top: obs.y, 
                      left: obsScreenX,
                      width: obs.type === 'HOLE' ? ROAD_WIDTH : (obs.type === 'RAMP' ? 60 : 30),
                      height: obs.type === 'HOLE' ? 40 : (obs.type === 'RAMP' ? 20 : 50),
                      transform: obs.type === 'HOLE' ? `translateX(${(CANVAS_WIDTH - ROAD_WIDTH) / 2 + roadOffsetAtObs - obsScreenX}px)` : 'none'
                    }}
                  >
                    {obs.type === 'CAR' && (
                      <img src={escarabajoSvg} alt="Car" className="w-full h-full object-contain drop-shadow-lg" />
                    )}
                    {obs.type === 'FAST_CAR' && (
                      <img src={bolidoSvg} alt="Fast Car" className="w-full h-full object-contain drop-shadow-lg rotate-180" />
                    )}
                    {obs.type === 'FUEL' && (
                      <div className="w-6 h-6 bg-amber-500 rounded shadow-lg flex items-center justify-center font-black text-[10px] text-black">F</div>
                    )}
                    {obs.type === 'OIL' && (
                      <div className="w-10 h-5 bg-black/60 rounded-full blur-[2px]" />
                    )}
                    {obs.type === 'RAMP' && (
                      <div className="w-full h-full bg-slate-400 border border-white/50 shadow-inner" />
                    )}
                    {obs.type === 'HOLE' && (
                      <div className="w-full h-full bg-black shadow-inner" />
                    )}
                  </div>
                );
              })}

              {/* Player */}
              <motion.div 
                className="absolute z-10"
                animate={{ 
                  x: stateRef.current.playerX, 
                  y: stateRef.current.playerY,
                  rotate: stateRef.current.keys.a ? -5 : stateRef.current.keys.d ? 5 : 0,
                  scale: stateRef.current.isJumping ? 1.5 : 1
                }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                style={{ width: PLAYER_WIDTH, height: PLAYER_HEIGHT }}
              >
                <img src={bugatySvg} alt="Player" className="w-full h-full object-contain drop-shadow-xl" />
              </motion.div>
            </div>

            {/* HUD Overlay */}
            <div className="absolute top-0 left-0 w-full p-4 flex flex-col gap-4 pointer-events-none">
              {/* Fuel Bar */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-tighter">
                  <div className="flex items-center gap-1">
                    <Fuel size={12} className={cn(fuel < 30 ? "text-red-500 animate-pulse" : "text-emerald-500")} />
                    <span>Fuel</span>
                  </div>
                  <span>{Math.floor(fuel)}%</span>
                </div>
                <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
                  <motion.div
                    className={cn(
                      "h-full transition-colors duration-300",
                      fuel > 50 ? "bg-emerald-500" : fuel > 25 ? "bg-yellow-500" : "bg-red-500"
                    )}
                    initial={{ width: "100%" }}
                    animate={{ width: `${fuel}%` }}
                  />
                </div>
              </div>

              {/* Speedometer */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-tighter">
                  <div className="flex items-center gap-1">
                    <Gauge size={12} className="text-blue-500" />
                    <span>Speed (Max: {Math.floor(maxSpeed * 20)} km/h)</span>
                  </div>
                  <span>{Math.floor(speed * 20)} km/h</span>
                </div>
                <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5">
                  <motion.div
                    className="h-full bg-blue-500"
                    animate={{ width: `${(speed / MAX_SPEED_LIMIT) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Game States */}
            <AnimatePresence>
              {gameState === 'START' && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center z-50"
                >
                  <Trophy className="text-yellow-500 mb-4" size={48} />
                  <h1 className="text-4xl font-black uppercase tracking-tighter mb-8 italic">Road Fighter</h1>
                  
                  {menuState === 'MAIN' && (
                    <div className="flex flex-col gap-4 w-full max-w-[240px]">
                      <button
                        onClick={resetGame}
                        className="group relative px-6 py-3 bg-white text-black font-black uppercase tracking-widest rounded-lg hover:scale-105 transition-transform flex items-center justify-center gap-2"
                      >
                        <Play size={18} fill="currentColor" />
                        New Game
                      </button>
                      <button
                        onClick={() => setMenuState('MAP')}
                        className="group relative px-6 py-3 bg-zinc-800 text-white font-bold uppercase tracking-widest rounded-lg hover:bg-zinc-700 transition-colors border border-white/10 flex items-center justify-center gap-2"
                      >
                        <Gauge size={18} />
                        Map
                      </button>
                      <button
                        onClick={() => setMenuState('NARRATIVE')}
                        className="group relative px-6 py-3 bg-zinc-800 text-white font-bold uppercase tracking-widest rounded-lg hover:bg-zinc-700 transition-colors border border-white/10 flex items-center justify-center gap-2"
                      >
                        <Fuel size={18} />
                        Narrative
                      </button>
                    </div>
                  )}

                  {menuState === 'NARRATIVE' && (
                    <div className="flex flex-col items-center w-full max-w-[320px]">
                      <h2 className="text-xl font-bold uppercase tracking-widest mb-4 text-blue-400">Mission Brief</h2>
                      <p className="text-zinc-300 text-sm mb-8 leading-relaxed text-justify bg-white/5 p-4 rounded-lg border border-white/10">
                        "La empresa en la cual trabajas está realizando una modificación al coche, sin embargo el cliente está por llegar y falta cambiarle una pieza al carro que pidió la modificación. Debes ser rápido y llegar antes de que se acabe el tiempo o el cliente demandará a la empresa y clausurará el negocio."
                      </p>
                      <button
                        onClick={() => setMenuState('MAIN')}
                        className="px-6 py-2 bg-zinc-800 text-white font-bold uppercase tracking-widest rounded-lg hover:bg-zinc-700 transition-colors border border-white/10"
                      >
                        Back
                      </button>
                    </div>
                  )}

                  {menuState === 'MAP' && (
                    <div className="flex flex-col items-center w-full">
                      <h2 className="text-xl font-bold uppercase tracking-widest mb-4 text-emerald-400">Track Overview</h2>
                      <div className="relative h-64 w-full max-w-[200px] bg-zinc-950 rounded-lg border border-white/10 overflow-hidden flex flex-col items-center mb-8">
                        <div className="absolute top-4 w-full flex justify-center z-10">
                          <div className="bg-emerald-500/20 text-emerald-400 text-[10px] font-black px-2 py-1 rounded border border-emerald-500/30 uppercase tracking-widest">
                            Finish (4 min)
                          </div>
                        </div>
                        <div className="absolute inset-y-8 w-2 bg-zinc-800 rounded-full" />
                        
                        {/* Checkpoints / Distance Markers */}
                        <div className="absolute top-1/4 w-full flex justify-center"><div className="w-4 h-0.5 bg-zinc-700" /></div>
                        <div className="absolute top-2/4 w-full flex justify-center"><div className="w-4 h-0.5 bg-zinc-700" /></div>
                        <div className="absolute top-3/4 w-full flex justify-center"><div className="w-4 h-0.5 bg-zinc-700" /></div>

                        <div className="absolute bottom-4 w-full flex justify-center z-10">
                          <div className="text-zinc-500 text-[10px] font-black uppercase tracking-widest">
                            Start
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => setMenuState('MAIN')}
                        className="px-6 py-2 bg-zinc-800 text-white font-bold uppercase tracking-widest rounded-lg hover:bg-zinc-700 transition-colors border border-white/10"
                      >
                        Back
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {gameState === 'GAMEOVER' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center z-50"
                >
                  <h2 className="text-5xl font-black uppercase tracking-tighter mb-2 italic text-red-500">
                    {time >= TOTAL_GAME_TIME ? "TIME'S UP" : (lives <= 0 ? "WRECKED" : "OUT OF FUEL")}
                  </h2>
                  <p className="text-red-200/70 text-sm mb-8 uppercase tracking-widest font-bold">
                    {time >= TOTAL_GAME_TIME ? "The client arrived before you!" : "Mission Failed"}
                  </p>
                  <div className="flex gap-8 my-8">
                    <div className="flex flex-col">
                      <span className="text-xs text-red-300/50 uppercase">Distance</span>
                      <span className="text-3xl font-mono font-bold">{Math.floor(distance / 100)} km</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-red-300/50 uppercase">Time</span>
                      <span className="text-3xl font-mono font-bold">{time.toFixed(1)}s</span>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button
                      onClick={resetGame}
                      className="flex items-center gap-2 px-8 py-4 bg-white text-black font-black uppercase tracking-widest rounded-full hover:bg-zinc-200 transition-colors"
                    >
                      <RotateCcw size={20} />
                      Try Again
                    </button>
                    <button
                      onClick={() => { setGameState('START'); setMenuState('MAIN'); }}
                      className="flex items-center gap-2 px-8 py-4 bg-zinc-800 text-white font-black uppercase tracking-widest rounded-full hover:bg-zinc-700 transition-colors border border-white/10"
                    >
                      <Home size={20} />
                      Menu
                    </button>
                  </div>
                </motion.div>
              )}

              {gameState === 'FINISHED' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute inset-0 bg-emerald-950/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center z-50"
                >
                  <Trophy className="text-yellow-500 mb-4 animate-bounce" size={64} />
                  <h2 className="text-4xl font-black uppercase tracking-tighter mb-2 italic text-emerald-400">
                    ¡LOGRASTE SALVAR EL NEGOCIO!
                  </h2>
                  <p className="text-emerald-100/70 text-sm mb-8 max-w-[280px]">
                    Has completado la pista a tiempo y entregado el pedido. ¡Excelente conducción!
                  </p>
                  <div className="flex gap-8 my-8">
                    <div className="flex flex-col">
                      <span className="text-xs text-emerald-300/50 uppercase">Final Score</span>
                      <span className="text-3xl font-mono font-bold">{Math.floor(distance / 10)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-xs text-emerald-300/50 uppercase">Time Left</span>
                      <span className="text-3xl font-mono font-bold">{(TOTAL_GAME_TIME - time).toFixed(1)}s</span>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button
                      onClick={resetGame}
                      className="flex items-center gap-2 px-8 py-4 bg-white text-black font-black uppercase tracking-widest rounded-full hover:bg-zinc-200 transition-colors"
                    >
                      <RotateCcw size={20} />
                      Play Again
                    </button>
                    <button
                      onClick={() => { setGameState('START'); setMenuState('MAIN'); }}
                      className="flex items-center gap-2 px-8 py-4 bg-zinc-800 text-white font-black uppercase tracking-widest rounded-full hover:bg-zinc-700 transition-colors border border-white/10"
                    >
                      <Home size={20} />
                      Menu
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Sidebar Panel (Replaces Code Inspector) */}
        <div className="w-full max-w-[400px] lg:w-[300px] flex flex-col gap-6">
          <div className="bg-zinc-900/50 rounded-xl border border-white/10 p-6 backdrop-blur-xl flex flex-col gap-8">
            <h3 className="text-lg font-black uppercase italic tracking-tighter flex items-center gap-2 border-b border-white/10 pb-4">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              Mission Status
            </h3>

            {/* Stats */}
            <div className="grid grid-cols-1 gap-6">
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold flex items-center gap-1">
                  <Trophy size={10} /> Progress
                </span>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-mono font-bold leading-none">{Math.floor((distance / TARGET_DISTANCE) * 100)}%</span>
                  <span className="text-xs text-zinc-500 mb-1">/ 100%</span>
                </div>
                <div className="w-full h-1 bg-zinc-800 mt-2 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, (distance / TARGET_DISTANCE) * 100)}%` }} />
                </div>
              </div>

              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold flex items-center gap-1">
                  <Timer size={10} /> Time Limit
                </span>
                <span className={cn(
                  "text-3xl font-mono font-bold leading-none",
                  TOTAL_GAME_TIME - time < 60 ? "text-red-500 animate-pulse" : "text-blue-400"
                )}>
                  {Math.max(0, TOTAL_GAME_TIME - time).toFixed(1)}s
                </span>
              </div>

              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Health / Lives</span>
                <div className="flex gap-1.5">
                  {Array.from({ length: INITIAL_LIVES }).map((_, i) => (
                    <div 
                      key={i} 
                      className={cn(
                        "w-3 h-6 rounded-sm transition-all duration-300",
                        i < lives ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]" : "bg-zinc-800"
                      )} 
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Track Map (Minimap) */}
            <div className="flex flex-col gap-3 mt-4">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Track Map</span>
              <div className="relative h-48 w-full bg-zinc-950 rounded-lg border border-white/5 overflow-hidden flex flex-col items-center">
                {/* Finish Line Indicator */}
                <div className="absolute top-2 w-full flex justify-center">
                  <div className="bg-emerald-500/20 text-emerald-400 text-[8px] font-black px-2 py-0.5 rounded border border-emerald-500/30 uppercase tracking-widest">
                    Finish
                  </div>
                </div>
                
                {/* Track Line */}
                <div className="absolute inset-y-8 w-1 bg-zinc-800 rounded-full" />
                
                {/* Player Progress Marker */}
                <motion.div 
                  className="absolute w-3 h-5 bg-blue-500 rounded-sm shadow-[0_0_15px_rgba(59,130,246,0.5)] border border-blue-400"
                  style={{ 
                    bottom: `${Math.min(100, (distance / TARGET_DISTANCE) * 100)}%`,
                    marginBottom: '0px',
                    transform: 'translateY(50%)'
                  }}
                />

                {/* Start Line Indicator */}
                <div className="absolute bottom-2 w-full flex justify-center">
                  <div className="text-zinc-600 text-[8px] font-black uppercase tracking-widest">
                    Start
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Controls Help (Moved to Sidebar) */}
          <div className="bg-zinc-900/30 rounded-xl border border-white/5 p-4 flex flex-col gap-3">
            <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold">Controls</span>
            <div className="flex flex-wrap gap-4 text-zinc-500 text-[10px] font-bold uppercase tracking-widest">
              <div className="flex items-center gap-1">
                <kbd className="px-2 py-1 bg-zinc-900 rounded border border-white/5 text-zinc-400">W</kbd>
                <span>Gas</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-2 py-1 bg-zinc-900 rounded border border-white/5 text-zinc-400">A/D</kbd>
                <span>Turn</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-2 py-1 bg-zinc-900 rounded border border-white/5 text-zinc-400">S</kbd>
                <span>Brake</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
