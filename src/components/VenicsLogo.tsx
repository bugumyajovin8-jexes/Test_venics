import React from 'react';

interface VenicsLogoProps {
  className?: string;
  size?: number | string;
  animate?: 'none' | 'idle' | 'loading' | 'active';
  vGradient?: [string, string]; // [startColor, endColor]
  outerGradient?: [string, string];
  innerGradient?: [string, string];
}

export default function VenicsLogo({
  className = '',
  size = '100%',
  animate = 'idle',
  vGradient = ['#4f46e5', '#818cf8'], // elegant indigo
  outerGradient = ['#3b82f6', '#06b6d4'], // blue to cyan
  innerGradient = ['#10b981', '#3b82f6'] // emerald to blue
}: VenicsLogoProps) {
  // Unique IDs for gradients to prevent clashes when multiple logos are rendered on screen
  const idPrefix = React.useId().replace(/:/g, '');
  const vGradId = `v-grad-${idPrefix}`;
  const outGradId = `out-grad-${idPrefix}`;
  const inGradId = `in-grad-${idPrefix}`;

  const [imgLoaded, setImgLoaded] = React.useState(false);

  const isNone = animate === 'none';
  const isLoading = animate === 'loading';

  const outerAnimClass = isNone 
    ? '' 
    : isLoading 
      ? 'venics-spin-clockwise-fast' 
      : 'venics-spin-clockwise-slow';

  const innerAnimClass = isNone 
    ? '' 
    : isLoading 
      ? 'venics-spin-counter-fast' 
      : 'venics-spin-counter-slow';

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg 
        viewBox="0 0 100 100" 
        className="w-full h-full overflow-visible"
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Outer Ring Gradient */}
          <linearGradient id={outGradId} x1="12" y1="12" x2="88" y2="88" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={outerGradient[0]} />
            <stop offset="100%" stopColor={outerGradient[1]} />
          </linearGradient>

          {/* Inner Ring Gradient */}
          <linearGradient id={inGradId} x1="22" y1="22" x2="78" y2="78" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={innerGradient[0]} />
            <stop offset="100%" stopColor={innerGradient[1]} />
          </linearGradient>
        </defs>

        <style>{`
          @keyframes venicsRotateClockwise {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes venicsRotateCounter {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(-360deg); }
          }
          .venics-spin-clockwise-slow {
            transform-origin: 50% 50%;
            animation: venicsRotateClockwise 12s linear infinite;
          }
          .venics-spin-clockwise-fast {
            transform-origin: 50% 50%;
            animation: venicsRotateClockwise 1.5s linear infinite;
          }
          .venics-spin-counter-slow {
            transform-origin: 50% 50%;
            animation: venicsRotateCounter 9s linear infinite;
          }
          .venics-spin-counter-fast {
            transform-origin: 50% 50%;
            animation: venicsRotateCounter 1.1s linear infinite;
          }
        `}</style>

        {/* Outer Circular Curved Ring */}
        <circle 
          cx="50" 
          cy="50" 
          r="41" 
          stroke={`url(#${outGradId})`} 
          strokeWidth="4" 
          strokeLinecap="round" 
          strokeDasharray="165 92" 
          className={outerAnimClass}
        />

        {/* Inner Circular Curved Ring */}
        <circle 
          cx="50" 
          cy="50" 
          r="29" 
          stroke={`url(#${inGradId})`} 
          strokeWidth="3.2" 
          strokeLinecap="round" 
          strokeDasharray="110 72" 
          className={innerAnimClass}
        />
      </svg>

      {/* Central V (brand mark, v.png). The spinning rings above are pure SVG and paint
          instantly, so the login screen never waits on this image. The V is fetched at low
          priority and fades in on load; a soft placeholder pulses in its place until then. */}
      <div
        className="absolute flex items-center justify-center pointer-events-none"
        style={{ width: '76%', height: '76%' }}
      >
        {!imgLoaded && (
          <div
            className="absolute rounded-full animate-pulse"
            style={{
              width: '48%',
              height: '48%',
              background: `radial-gradient(circle, ${vGradient[1]}55 0%, transparent 70%)`
            }}
          />
        )}
        <img
          src="/v.png"
          className="w-full h-full object-contain transition-opacity duration-500"
          style={{ opacity: imgLoaded ? 1 : 0 }}
          decoding="async"
          fetchPriority="low"
          referrerPolicy="no-referrer"
          alt="V"
          onLoad={() => setImgLoaded(true)}
        />
      </div>
    </div>
  );
}
