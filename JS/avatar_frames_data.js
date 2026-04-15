// JS/avatar_frames_data.js
// Avatar Frames Data — V3.3
// FIX: btoa() không hỗ trợ Unicode → dùng encodeURIComponent để tạo SVG data URI an toàn
// FIX: Expose window.AVATAR_FRAMES ngay trong file này (không cần inline script trong HTML)

// ─── Helper: SVG string → safe data URI ──────────────────
function svgToDataUri(svgString) {
  // encodeURIComponent xử lý Unicode đúng, browser hỗ trợ data:image/svg+xml,<encoded>
  return 'data:image/svg+xml,' + encodeURIComponent(svgString.trim());
}

// ─── SVG definitions (plain strings, không dùng btoa) ────
const SVG = {
  // ── Free ──────────────────────────────────────────────────
  classic_gold: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#FFD700"/>
          <stop offset="100%" stop-color="#FFA500"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#g1)" stroke-width="8"/>
      <circle cx="100" cy="100" r="88" fill="none" stroke="#FFD700" stroke-width="1.5" opacity="0.4"/>
    </svg>`),

  silver_circle: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#E8E8E8"/>
          <stop offset="50%"  stop-color="#C0C0C0"/>
          <stop offset="100%" stop-color="#808080"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#g2)" stroke-width="8"/>
      <circle cx="100" cy="100" r="88" fill="none" stroke="#C0C0C0" stroke-width="1.5" opacity="0.35"/>
    </svg>`),

  // ── Special — 1 Ngày ─────────────────────────────────────
  bronze_star: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gBronze" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#CD7F32"/>
          <stop offset="100%" stop-color="#8B4513"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#gBronze)" stroke-width="10"/>
      <path d="M100 14 l7 22h23l-18.5 13.5 7 22L100 58 81.5 71.5l7-22L70 36h23z"
            fill="#CD7F32" opacity="0.35"/>
    </svg>`),

  // ── Special — 1 Tuần ─────────────────────────────────────
  emerald_ring: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gEmerald" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#50C878"/>
          <stop offset="100%" stop-color="#2E8B57"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#gEmerald)" stroke-width="12"/>
      <circle cx="100" cy="100" r="84" fill="none" stroke="#50C878" stroke-width="3" opacity="0.45"/>
    </svg>`),

  // ── Special — 1 Tháng ────────────────────────────────────
  sapphire_crown: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gSapphire" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#4B8EF0"/>
          <stop offset="100%" stop-color="#082567"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#gSapphire)" stroke-width="10"/>
      <polyline points="68,32 80,8 100,28 120,8 132,32"
                fill="none" stroke="#4B8EF0" stroke-width="4" stroke-linejoin="round" opacity="0.6"/>
    </svg>`),

  // ── Special — 1 Năm ──────────────────────────────────────
  ruby_flame: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gRuby" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#FF4444"/>
          <stop offset="100%" stop-color="#8B0000"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#gRuby)" stroke-width="12"/>
      <circle cx="100" cy="100" r="84" fill="none" stroke="#FF4444" stroke-width="3" opacity="0.3"/>
      <path d="M100 15 C95 30 80 35 85 55 C88 68 78 72 82 85 C88 102 100 95 100 95
               C100 95 112 102 118 85 C122 72 112 68 115 55 C120 35 105 30 100 15Z"
            fill="#FF4444" opacity="0.2"/>
    </svg>`),

  // ── Special — 2 Năm ──────────────────────────────────────
  diamond_aura: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gDiamond" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#B9F2FF"/>
          <stop offset="50%"  stop-color="#7DD3FC"/>
          <stop offset="100%" stop-color="#38BDF8"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#gDiamond)" stroke-width="12"/>
      <circle cx="100" cy="100" r="84" fill="none" stroke="#B9F2FF" stroke-width="4" opacity="0.5"/>
      <polygon points="100,10 125,50 190,50 140,85 160,130 100,100 40,130 60,85 10,50 75,50"
               fill="none" stroke="#7DD3FC" stroke-width="1.5" opacity="0.25"/>
    </svg>`),

  // ── Special — 3 Năm ──────────────────────────────────────
  amethyst_vortex: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gAmethyst" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#C084FC"/>
          <stop offset="100%" stop-color="#7C3AED"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#gAmethyst)" stroke-width="14"/>
      <circle cx="100" cy="100" r="82" fill="none" stroke="#A855F7" stroke-width="3" opacity="0.4"/>
      <circle cx="100" cy="100" r="70" fill="none" stroke="#C084FC" stroke-width="1.5" opacity="0.25"/>
    </svg>`),

  // ── Special — 5 Năm ──────────────────────────────────────
  aurora_borealis: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gAurora" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#00C9FF"/>
          <stop offset="33%"  stop-color="#92FE9D"/>
          <stop offset="66%"  stop-color="#FC5C7D"/>
          <stop offset="100%" stop-color="#00C9FF"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#gAurora)" stroke-width="14"/>
      <circle cx="100" cy="100" r="82" fill="none" stroke="#92FE9D" stroke-width="3" opacity="0.4"/>
      <circle cx="100" cy="100" r="70" fill="none" stroke="#00C9FF" stroke-width="1.5" opacity="0.25"/>
    </svg>`),

  // ── Special — 10 Năm ─────────────────────────────────────
  eternal_galaxy: svgToDataUri(`
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gGalaxy" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stop-color="#191970"/>
          <stop offset="25%"  stop-color="#4B0082"/>
          <stop offset="50%"  stop-color="#8B008B"/>
          <stop offset="75%"  stop-color="#4B0082"/>
          <stop offset="100%" stop-color="#191970"/>
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill="none" stroke="url(#gGalaxy)" stroke-width="16"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="#4B0082" stroke-width="3" opacity="0.4"/>
      <circle cx="80"  cy="80"  r="2"   fill="#FFD700" opacity="0.9"/>
      <circle cx="120" cy="70"  r="1.5" fill="#FFFFFF"  opacity="0.9"/>
      <circle cx="110" cy="120" r="2.5" fill="#87CEEB"  opacity="0.8"/>
      <circle cx="85"  cy="130" r="1"   fill="#FFD700"  opacity="0.9"/>
      <circle cx="140" cy="110" r="1.5" fill="#FFFFFF"  opacity="0.7"/>
      <circle cx="65"  cy="100" r="2"   fill="#87CEEB"  opacity="0.8"/>
    </svg>`)
};

// ═══════════════════════════════════════════════════════════
// AVATAR_FRAMES — main export object
// ═══════════════════════════════════════════════════════════
const AVATAR_FRAMES = {
  free: [
    {
      id: 'none',
      name: 'Không khung',
      type: 'free',
      image: null,
      unlocked: true
    },
    {
      id: 'classic_gold',
      name: 'Vàng cổ điển',
      type: 'free',
      image: SVG.classic_gold,
      unlocked: true
    },
    {
      id: 'silver_circle',
      name: 'Bạc đơn giản',
      type: 'free',
      image: SVG.silver_circle,
      unlocked: true
    }
  ],

  special: [
    
    {
      id: 'bronze_star',
      name: 'Sao đồng',
      type: 'special',
      image: SVG.bronze_star,
      requirement: '1_day',
      requirementText: '1 Ngày đồng hành',
      unlocked: false
    },
    {
      id: 'emerald_ring',
      name: 'Nhẫn ngọc lục bảo',
      type: 'special',
      image: SVG.emerald_ring,
      requirement: '1_week',
      requirementText: '1 Tuần đồng hành',
      unlocked: false
    },
    {
      id: 'sapphire_crown',
      name: 'Vương miện sapphire',
      type: 'special',
      image: SVG.sapphire_crown,
      requirement: '1_month',
      requirementText: '1 Tháng đồng hành',
      unlocked: false
    },
    {
      id: 'ruby_flame',
      name: 'Ngọn lửa ruby',
      type: 'special',
      image: SVG.ruby_flame,
      requirement: '1_year',
      requirementText: '1 Năm đồng hành',
      unlocked: false
    },
    {
      id: 'diamond_aura',
      name: 'Hào quang kim cương',
      type: 'special',
      image: SVG.diamond_aura,
      requirement: '2_years',
      requirementText: '2 Năm đồng hành',
      unlocked: false
    },
    {
      id: 'amethyst_vortex',
      name: 'Xoáy tím amethyst',
      type: 'special',
      image: SVG.amethyst_vortex,
      requirement: '3_years',
      requirementText: '3 Năm đồng hành',
      unlocked: false
    },
    {
      id: 'aurora_borealis',
      name: 'Cực quang bắc',
      type: 'special',
      image: SVG.aurora_borealis,
      requirement: '5_years',
      requirementText: '5 Năm đồng hành',
      unlocked: false
    },
    {
      id: 'eternal_galaxy',
      name: 'Thiên hà vĩnh cửu',
      type: 'special',
      image: SVG.eternal_galaxy,
      requirement: '10_years',
      requirementText: '10 Năm đồng hành',
      unlocked: false
    }
  ]
};

// ═══════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════

function getAllFrames() {
  return [...AVATAR_FRAMES.free, ...AVATAR_FRAMES.special];
}

/**
 * Check if a frame is unlocked.
 * achievementsData can be:
 *   - { _createdAt: Date | string }  ← format used by profile.js V3.3
 *   - { [requirementKey]: { completed: true } }  ← legacy format
 */
function checkFrameUnlock(frameId, achievementsData) {
  const frame = getAllFrames().find(f => f.id === frameId);
  if (!frame) return false;
  if (frame.type === 'free') return true;
  if (!achievementsData) return false;

  const req = frame.requirement;
  if (!req) return false;

  // ── Format A: createdAt-based (V3.3) ──────────────────
  if (achievementsData._createdAt) {
    const MS = { day:86400000, week:604800000, month:2592000000, year:31536000000 };
    const THRESHOLDS = {
      '1_day':    MS.day,       '1_week':   MS.week,
      '1_month':  MS.month,     '1_year':   MS.year,
      '2_years':  2*MS.year,    '3_years':  3*MS.year,
      '4_years':  4*MS.year,    '5_years':  5*MS.year,
      '10_years': 10*MS.year
    };
    if (!THRESHOLDS[req]) return false;
    const created = achievementsData._createdAt instanceof Date
      ? achievementsData._createdAt
      : new Date(achievementsData._createdAt);
    if (isNaN(created.getTime())) return false;
    return (Date.now() - created.getTime()) >= THRESHOLDS[req];
  }

  // ── Format B: legacy { [key]: { completed } } ─────────
  return !!(achievementsData[req]?.completed);
}

// ═══════════════════════════════════════════════════════════
// EXPOSE TO WINDOW — must happen synchronously so ES module
// profile.js can read window.AVATAR_FRAMES immediately.
// ═══════════════════════════════════════════════════════════
window.AVATAR_FRAMES    = AVATAR_FRAMES;
window.getAllFrames      = getAllFrames;
window.checkFrameUnlock = checkFrameUnlock;

// CommonJS compat (Node / bundler)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AVATAR_FRAMES, getAllFrames, checkFrameUnlock };
}