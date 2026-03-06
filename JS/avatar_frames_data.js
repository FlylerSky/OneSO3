// Avatar Frames Data Configuration
// 3 khung miễn phí + 9 khung đặc biệt (mở khóa qua thành tích)

const AVATAR_FRAMES = {
  // Khung miễn phí (luôn có sẵn)
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
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#grad1)" stroke-width="8"/>
          <defs>
            <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#FFA500;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      unlocked: true
    },
    {
      id: 'silver_circle',
      name: 'Bạc đơn giản',
      type: 'free',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#grad2)" stroke-width="8"/>
          <defs>
            <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#C0C0C0;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#808080;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      unlocked: true
    }
  ],
  
  // Khung đặc biệt (mở khóa qua thành tích)
  special: [
    {
      id: 'bronze_star',
      name: 'Sao đồng',
      type: 'special',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#gradBronze)" stroke-width="10"/>
          <path d="M 100 10 L 110 50 L 150 50 L 120 75 L 130 115 L 100 90 L 70 115 L 80 75 L 50 50 L 90 50 Z" fill="#CD7F32" opacity="0.3"/>
          <defs>
            <linearGradient id="gradBronze" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#CD7F32;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#8B4513;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: '1_day',
      requirementText: '1 Ngày',
      unlocked: false
    },
    {
      id: 'emerald_ring',
      name: 'Nhẫn ngọc lục bảo',
      type: 'special',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#gradEmerald)" stroke-width="12"/>
          <circle cx="100" cy="100" r="85" fill="none" stroke="#50C878" stroke-width="3" opacity="0.5"/>
          <defs>
            <linearGradient id="gradEmerald" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#50C878;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#2E8B57;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: '1_week',
      requirementText: '1 Tuần',
      unlocked: false
    },
    {
      id: 'sapphire_crown',
      name: 'Vương miện sapphire',
      type: 'special',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#gradSapphire)" stroke-width="10"/>
          <path d="M 100 5 L 105 30 L 115 15 L 120 35 L 130 20 L 135 40" stroke="#0F52BA" stroke-width="4" fill="none" opacity="0.6"/>
          <defs>
            <linearGradient id="gradSapphire" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#0F52BA;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#082567;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: '1_month',
      requirementText: '1 Tháng',
      unlocked: false
    },
    {
      id: 'ruby_flame',
      name: 'Ngọn lửa ruby',
      type: 'special',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#gradRuby)" stroke-width="12"/>
          <circle cx="100" cy="100" r="85" fill="none" stroke="#E0115F" stroke-width="2" stroke-dasharray="5,5" opacity="0.4"/>
          <defs>
            <linearGradient id="gradRuby" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#E0115F;stop-opacity:1" />
              <stop offset="50%" style="stop-color:#DC143C;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#8B0000;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: '1_year',
      requirementText: '1 Năm',
      unlocked: false
    },
    {
      id: 'amethyst_shield',
      name: 'Khiên thạch anh tím',
      type: 'special',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#gradAmethyst)" stroke-width="14"/>
          <polygon points="100,20 130,50 130,80 100,100 70,80 70,50" fill="#9966CC" opacity="0.2"/>
          <defs>
            <linearGradient id="gradAmethyst" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#9966CC;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#6A0DAD;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: '2_years',
      requirementText: '2 Năm',
      unlocked: false
    },
    {
      id: 'diamond_halo',
      name: 'Hào quang kim cương',
      type: 'special',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#gradDiamond)" stroke-width="10"/>
          <circle cx="100" cy="100" r="88" fill="none" stroke="#B9F2FF" stroke-width="2" opacity="0.6"/>
          <circle cx="100" cy="100" r="80" fill="none" stroke="#E3F4F7" stroke-width="1" opacity="0.4"/>
          <defs>
            <linearGradient id="gradDiamond" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#B9F2FF;stop-opacity:1" />
              <stop offset="50%" style="stop-color:#E3F4F7;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#FFFFFF;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: '3_years',
      requirementText: '3 Năm',
      unlocked: false
    },
    {
      id: 'platinum_wings',
      name: 'Cánh bạch kim',
      type: 'special',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#gradPlatinum)" stroke-width="12"/>
          <path d="M 30 100 Q 50 70, 70 90" stroke="#E5E4E2" stroke-width="3" fill="none" opacity="0.5"/>
          <path d="M 170 100 Q 150 70, 130 90" stroke="#E5E4E2" stroke-width="3" fill="none" opacity="0.5"/>
          <defs>
            <linearGradient id="gradPlatinum" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#E5E4E2;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#C0C0C0;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: '4_years',
      requirementText: '4 Năm',
      unlocked: false
    },
    {
      id: 'mythic_aurora',
      name: 'Cực quang huyền thoại',
      type: 'special',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#gradAurora)" stroke-width="15"/>
          <circle cx="100" cy="100" r="88" fill="none" stroke="url(#gradAurora2)" stroke-width="3" opacity="0.5">
            <animate attributeName="stroke-dashoffset" from="0" to="360" dur="3s" repeatCount="indefinite"/>
          </circle>
          <defs>
            <linearGradient id="gradAurora" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#00FF87;stop-opacity:1" />
              <stop offset="33%" style="stop-color:#60EFFF;stop-opacity:1" />
              <stop offset="66%" style="stop-color:#B967FF;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#FF6BCB;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="gradAurora2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" style="stop-color:#FF6BCB;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#00FF87;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: '5_years',
      requirementText: '5 Năm',
      unlocked: false
    },
    {
      id: 'eternal_galaxy',
      name: 'Thiên hà vĩnh cửu',
      type: 'special',
      image: 'data:image/svg+xml;base64,' + btoa(`
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          <circle cx="100" cy="100" r="95" fill="none" stroke="url(#gradGalaxy)" stroke-width="16"/>
          <circle cx="80" cy="80" r="2" fill="#FFD700"/>
          <circle cx="120" cy="70" r="1.5" fill="#FFFFFF"/>
          <circle cx="110" cy="120" r="2.5" fill="#87CEEB"/>
          <circle cx="85" cy="130" r="1" fill="#FFD700"/>
          <defs>
            <linearGradient id="gradGalaxy" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#191970;stop-opacity:1" />
              <stop offset="25%" style="stop-color:#4B0082;stop-opacity:1" />
              <stop offset="50%" style="stop-color:#8B008B;stop-opacity:1" />
              <stop offset="75%" style="stop-color:#4B0082;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#000080;stop-opacity:1" />
            </linearGradient>
          </defs>
        </svg>
      `),
      requirement: '10_years',
      requirementText: '10 Năm',
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
  
  // Check if user has completed the required achievement
  if (achievementsData && achievementsData[frame.requirement]) {
    return achievementsData[frame.requirement].completed === true;
  }
  
  return false;
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AVATAR_FRAMES, getAllFrames, checkFrameUnlock };
}