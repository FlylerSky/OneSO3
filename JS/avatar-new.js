// Avatar Frames Data Configuration
// Chủ đề: Thủy triều âm nhạc (5 khung miễn phí + 3 khung mở khóa)

// Hàm helper để encode SVG an toàn
function encodeSVG(svgString) {
  const cleaned = svgString.replace(/\s+/g, ' ').trim();
  return 'data:image/svg+xml,' + encodeURIComponent(cleaned);
}

const AVATAR_FRAMES = {
  // Khung miễn phí (luôn có sẵn) - 5 Khung
  free: [
    {
      id: 'none',
      name: 'Không khung',
      type: 'free',
      image: null,
      unlocked: true
    },
    {
      id: 'wave_blue',
      name: 'Sóng xanh biển',
      type: 'free',
      image: encodeSVG(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#oceanGrad)" stroke-width="8"/>
          <path d="M 20 120 Q 40 105, 60 120 T 100 120 T 140 120 T 180 120" fill="none" stroke="#00FFFF" stroke-width="2" opacity="0.6"/>
          <path d="M 30 135 Q 50 120, 70 135 T 110 135 T 150 135 T 190 135" fill="none" stroke="#1E90FF" stroke-width="2" opacity="0.4"/>
          <defs>
            <linearGradient id="oceanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#00BFFF"/>
              <stop offset="100%" stop-color="#000080"/>
            </linearGradient>
          </defs>
        </svg>
      `),
      unlocked: true
    },
    {
      id: 'coral_rhythm',
      name: 'San hô nhịp điệu',
      type: 'free',
      image: encodeSVG(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#coralGrad)" stroke-width="9"/>
          <!-- Nốt nhạc trên san hô -->
          <circle cx="65" cy="130" r="7" fill="#FF6347" opacity="0.8"/>
          <line x1="72" y1="130" x2="72" y2="95" stroke="#FF6347" stroke-width="3" opacity="0.8"/>
          <path d="M 72 95 Q 80 100, 80 110" fill="none" stroke="#FF6347" stroke-width="3" opacity="0.8"/>
          <!-- Sóng âm -->
          <path d="M 120 120 Q 130 100, 140 120 T 160 120" fill="none" stroke="#FFD700" stroke-width="2" opacity="0.6"/>
          <path d="M 120 135 Q 130 115, 140 135 T 160 135" fill="none" stroke="#FFD700" stroke-width="2" opacity="0.4"/>
          <defs>
            <linearGradient id="coralGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#FF7F50"/>
              <stop offset="100%" stop-color="#DC143C"/>
            </linearGradient>
          </defs>
        </svg>
      `),
      unlocked: true
    },
    {
      id: 'pearl_echo',
      name: 'Ngọc trai âm vang',
      type: 'free',
      image: encodeSVG(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#pearlGrad)" stroke-width="11"/>
          <!-- Ngọc trai -->
          <circle cx="75" cy="75" r="10" fill="#FFF5EE" opacity="0.8"/>
          <circle cx="73" cy="73" r="3" fill="#FFFFFF" opacity="0.9"/>
          <circle cx="125" cy="125" r="8" fill="#FFF5EE" opacity="0.7"/>
          <circle cx="123" cy="123" r="2" fill="#FFFFFF" opacity="0.9"/>
          <!-- Sóng lan tỏa -->
          <circle cx="100" cy="100" r="40" fill="none" stroke="#FFF" stroke-width="1" opacity="0.3" stroke-dasharray="4,4"/>
          <circle cx="100" cy="100" r="55" fill="none" stroke="#FFF" stroke-width="1" opacity="0.2" stroke-dasharray="6,6"/>
          <defs>
            <linearGradient id="pearlGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#F5F5DC"/>
              <stop offset="100%" stop-color="#DEB887"/>
            </linearGradient>
          </defs>
        </svg>
      `),
      unlocked: true
    },
    {
      id: 'tidal_wave',
      name: 'Sóng thần giai điệu',
      type: 'free',
      image: encodeSVG(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#tidalGrad)" stroke-width="13"/>
          <!-- Sóng lớn -->
          <path d="M 10 140 Q 30 100, 50 130 T 90 130 T 130 130 T 170 130 T 190 140" fill="none" stroke="#00CED1" stroke-width="3" opacity="0.7"/>
          <path d="M 10 155 Q 30 120, 50 145 T 90 145 T 130 145 T 170 145 T 190 155" fill="none" stroke="#00BFFF" stroke-width="2.5" opacity="0.5"/>
          <!-- Hình nốt nhạc trong sóng -->
          <circle cx="140" cy="110" r="5" fill="#FFD700" opacity="0.8"/>
          <line x1="145" y1="110" x2="145" y2="85" stroke="#FFD700" stroke-width="2.5" opacity="0.8"/>
          <defs>
            <linearGradient id="tidalGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#006994"/>
              <stop offset="50%" stop-color="#003366"/>
              <stop offset="100%" stop-color="#000033"/>
            </linearGradient>
          </defs>
        </svg>
      `),
      unlocked: true
    }
  ],
  
  // Khung yêu cầu mở khóa - 3 Khung MỚI
  special: [
    {
      id: 'abyss_symphony',
      name: 'Giao hưởng vực sâu',
      type: 'special',
      image: encodeSVG(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#abyssGrad)" stroke-width="12"/>
          <!-- Cá voi phát ra sóng âm -->
          <ellipse cx="80" cy="130" rx="15" ry="8" fill="#4A90E2" opacity="0.4"/>
          <!-- Sóng âm tròn -->
          <circle cx="80" cy="100" r="15" fill="none" stroke="#4A90E2" stroke-width="2" opacity="0.5"/>
          <circle cx="80" cy="100" r="25" fill="none" stroke="#4A90E2" stroke-width="1.5" opacity="0.3"/>
          <circle cx="80" cy="100" r="35" fill="none" stroke="#4A90E2" stroke-width="1" opacity="0.2"/>
          <!-- Nốt nhạc phát sáng -->
          <circle cx="140" cy="70" r="6" fill="#00FFFF" opacity="0.9"/>
          <line x1="146" y1="70" x2="146" y2="45" stroke="#00FFFF" stroke-width="3" opacity="0.9"/>
          <path d="M 146 45 Q 155 50, 155 60" fill="none" stroke="#00FFFF" stroke-width="3" opacity="0.9"/>
          <defs>
            <linearGradient id="abyssGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#0A192F"/>
              <stop offset="50%" stop-color="#172A45"/>
              <stop offset="100%" stop-color="#020C1B"/>
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: 'abyss_achievement',
      requirementText: 'Nghe 100 giờ nhạc',
      unlocked: false
    },
    {
      id: 'stormy_beat',
      name: 'Bão tố tiết tấu',
      type: 'special',
      image: encodeSVG(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#stormGrad)" stroke-width="14"/>
          <!-- Tia sét -->
          <polyline points="120,40 110,70 125,70 115,100" fill="none" stroke="#FFD700" stroke-width="3" opacity="0.8"/>
          <!-- Sóng dữ -->
          <path d="M 30 130 Q 50 100, 70 130 T 110 130" fill="none" stroke="#87CEEB" stroke-width="4" opacity="0.6"/>
          <path d="M 50 145 Q 70 115, 90 145 T 130 145" fill="none" stroke="#ADD8E6" stroke-width="3" opacity="0.4"/>
          <!-- Trống sấm -->
          <circle cx="75" cy="90" r="8" fill="#FF6347" opacity="0.5"/>
          <circle cx="75" cy="90" r="12" fill="none" stroke="#FF6347" stroke-width="2" opacity="0.3"/>
          <defs>
            <linearGradient id="stormGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#2F4F4F"/>
              <stop offset="50%" stop-color="#191970"/>
              <stop offset="100%" stop-color="#000000"/>
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: 'storm_achievement',
      requirementText: 'Tạo 10 playlist',
      unlocked: false
    },
    {
      id: 'midnight_serenade',
      name: 'Dạ khúc nửa đêm',
      type: 'special',
      image: encodeSVG(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#midnightGrad)" stroke-width="15"/>
          <!-- Trăng khuyết -->
          <path d="M 65 60 A 30 30 0 1 0 105 95 A 25 25 0 1 1 65 60" fill="#F5F5DC" opacity="0.9"/>
          <!-- Đàn guitar dưới trăng -->
          <circle cx="130" cy="140" r="12" fill="#8B4513" opacity="0.6"/>
          <line x1="130" y1="128" x2="130" y2="110" stroke="#8B4513" stroke-width="3" opacity="0.6"/>
          <line x1="124" y1="115" x2="136" y2="115" stroke="#8B4513" stroke-width="2" opacity="0.6"/>
          <!-- Nốt nhạc bay -->
          <circle cx="100" cy="50" r="4" fill="#FFD700" opacity="0.8"/>
          <line x1="104" y1="50" x2="104" y2="30" stroke="#FFD700" stroke-width="2" opacity="0.8"/>
          <path d="M 104 30 Q 112 35, 112 42" fill="none" stroke="#FFD700" stroke-width="2" opacity="0.8"/>
          <circle cx="150" cy="60" r="3" fill="#FFD700" opacity="0.6"/>
          <line x1="153" y1="60" x2="153" y2="42" stroke="#FFD700" stroke-width="2" opacity="0.6"/>
          <defs>
            <linearGradient id="midnightGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#0B132B"/>
              <stop offset="50%" stop-color="#1C2541"/>
              <stop offset="100%" stop-color="#000000"/>
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: 'midnight_achievement',
      requirementText: 'Nghe nhạc lúc 0h-4h sáng',
      unlocked: false
    }
  ]
};

// Helper function to get all frames
function getAllFrames() {
  return [...AVATAR_FRAMES.free, ...AVATAR_FRAMES.special];
}

// Helper function to check if frame is unlocked based on achievements
function checkFrameUnlock(frameId, achievementsData) {
  const allFrames = getAllFrames();
  const frame = allFrames.find(f => f.id === frameId);
  
  if (!frame) return false;
  if (frame.type === 'free') return true;
  
  if (achievementsData && achievementsData[frame.requirement]) {
    return achievementsData[frame.requirement].completed === true;
  }
  
  return false;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AVATAR_FRAMES, getAllFrames, checkFrameUnlock };
}