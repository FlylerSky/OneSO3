/* -------- tag.js (Christmas Enhancements) -------- */
// Inject Snowflakes
for(let i=0; i<40; i++){
  const s = document.createElement('div');
  s.className = 'snowflake';
  s.textContent = '❄';
  s.style.left = Math.random()*100 + 'vw';
  s.style.animationDuration = (5 + Math.random()*7) + 's';
  s.style.fontSize = (10 + Math.random()*10) + 'px';
  document.body.appendChild(s);
}
