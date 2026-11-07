let quadrantSphereCleanup = null;
function mountQuadrantSpheres(stage) {
  quadrantSphereCleanup?.();
  if (!stage) return;
  const abort = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointer = {x: 0, y: 0, active: false};
  let width = 0, height = 0, frame = 0, hoverTimer = 0, leaveTimer = 0;
  let hovered = -1, expanded = -1, quietFrames = 0, lastTime = 0;
  const balls = [...stage.querySelectorAll('[data-sphere-q]')].map((element, q) => ({
    element, q, count: Number(element.dataset.count), x: 0, y: 0, vx: 0, vy: 0,
    r: 0, vr: 0, base: 0, target: 0, ax: 0, ay: 0,
    button: element.querySelector('.sphere-hit-area'), preview: element.querySelector('.sphere-preview')
  }));
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  function wake() { quietFrames = 0; if (!frame) frame = requestAnimationFrame(tick); }
  function expand(q) {
    expanded = q;
    balls.forEach(ball => {
      const active = ball.q === q;
      ball.element.classList.toggle('is-expanded', active);
      ball.button.setAttribute('aria-expanded', String(active));
      ball.preview.inert = !active;
      ball.preview.setAttribute('aria-hidden', String(!active));
      ball.element.style.zIndex = active ? '4' : String(1 + ball.q % 2);
      ball.target = active ? Math.min(ball.count ? 420 : 300, width * .91, height * .8) / 2 : ball.base;
    });
    wake();
  }
  function arm(q) {
    if (document.querySelector('#modal-root .modal-backdrop')) return;
    clearTimeout(leaveTimer);
    if (hovered === q) return;
    hovered = q;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => { if (hovered === q) expand(q); }, 1000);
  }
  function release(q) {
    if (hovered === q) { hovered = -1; clearTimeout(hoverTimer); }
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      const ball = balls[expanded];
      if (!ball || ball.element.querySelector(':focus-visible') || ball.element.matches(':hover')) return;
      expand(-1);
    }, 260);
  }
  function resize() {
    const box = stage.getBoundingClientRect();
    width = box.width; height = box.height;
    if (!width || !height) return;
    const mobile = width < 600;
    balls.forEach(ball => {
      const emptyDiameter = mobile ? 112 : 152;
      // Leave room for two neighboring circles on narrow screens while keeping sizes ordered by count.
      const mobileLimit = Math.max(emptyDiameter, (width - 28) / 2);
      const diameter = ball.count === 0 ? emptyDiameter : mobile
        ? emptyDiameter + (mobileLimit - emptyDiameter) * (1 - Math.exp(-Math.sqrt(ball.count) / 3))
        : Math.min(338, 176 + Math.sqrt(ball.count) * 30);
      ball.base = Math.min(diameter / 2, width / 2 - 12);
      if (!ball.r) ball.r = ball.base;
    });
    const [a,b,c,d] = balls, cx = width / 2, cy = height / 2;
    const anchors = [
      [cx-(a.base+b.base)*.47,cy-(a.base+c.base)*.42],
      [cx+(a.base+b.base)*.43,cy-(b.base+d.base)*.32],
      [cx-(c.base+d.base)*.48,cy+(a.base+c.base)*.48],
      [cx+(c.base+d.base)*.43,cy+(b.base+d.base)*.48]
    ];
    balls.forEach((ball,i) => {
      [ball.ax,ball.ay] = anchors[i];
      if (!ball.x && !ball.y) { ball.x=ball.ax; ball.y=ball.ay; }
    });
    expand(expanded);
  }
  function updateOverflow(ball) {
    const list = ball.preview.querySelector('.sphere-task-list');
    ball.preview.querySelector('.sphere-more').hidden = list.scrollHeight - list.clientHeight - list.scrollTop < 3;
  }
  function tick(now) {
    frame = 0;
    if (!stage.isConnected) { cleanup(); return; }
    const dt = clamp(lastTime ? (now-lastTime)/16.667 : 1, .3, 2);
    lastTime = now;
    let movement = 0;
    const before = balls.map(ball => [ball.x,ball.y,ball.r]);
    balls.forEach(ball => {
      let tx = expanded === ball.q ? width/2 : ball.ax;
      let ty = expanded === ball.q ? height/2 : ball.ay;
      if (pointer.active && !reduced) {
        const dx=pointer.x-ball.x,dy=pointer.y-ball.y,distance=Math.hypot(dx,dy),reach=ball.r+220;
        const pull = Math.sqrt(Math.max(0,1-distance/reach)), limit = expanded === ball.q ? 22 : 64;
        tx += clamp(dx*.42,-limit,limit)*pull;
        ty += clamp(dy*.42,-limit,limit)*pull;
      }
      if (reduced) { ball.x=tx; ball.y=ty; ball.r=ball.target; }
      else {
        ball.vx=(ball.vx+(tx-ball.x)*.026*dt)*Math.pow(.83,dt);
        ball.vy=(ball.vy+(ty-ball.y)*.026*dt)*Math.pow(.83,dt);
        ball.vr=(ball.vr+(ball.target-ball.r)*.065*dt)*Math.pow(.76,dt);
        ball.x+=ball.vx*dt; ball.y+=ball.vy*dt; ball.r+=ball.vr*dt;
      }
    });
    // A soft contact constraint makes the circles form a pile rather than overlap.
    for (let pass=0;pass<5;pass++) {
      for (let i=0;i<balls.length;i++) for (let j=i+1;j<balls.length;j++) {
        const a=balls[i],b=balls[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
        const contact=a.r+b.r+12;
        if (d>=contact) continue;
        const push=(contact-d)*1.02,nx=dx/d,ny=dy/d;
        const massA=a.r*a.r,massB=b.r*b.r,total=massA+massB;
        a.x-=nx*push*massB/total; a.y-=ny*push*massB/total;
        b.x+=nx*push*massA/total; b.y+=ny*push*massA/total;
      }
      balls.forEach(ball => {
        ball.x=clamp(ball.x,ball.r+8,width-ball.r-8);
        ball.y=clamp(ball.y,ball.r+8,height-ball.r-8);
      });
    }
    if (expanded < 0) {
      const left=Math.min(...balls.map(ball=>ball.x-ball.r)),right=Math.max(...balls.map(ball=>ball.x+ball.r));
      const top=Math.min(...balls.map(ball=>ball.y-ball.r)),bottom=Math.max(...balls.map(ball=>ball.y+ball.r));
      balls.forEach(ball=>{ball.x+=(width/2-(left+right)/2)*.04;ball.y+=(height/2-(top+bottom)/2)*.04;});
    }
    balls.forEach((ball,i) => {
      const speed=Math.hypot(ball.x-before[i][0],ball.y-before[i][1]);
      movement=Math.max(movement,speed,Math.abs(ball.r-before[i][2]));
      // Actual displacement drives the jelly shape; contact forces cannot leave a resting circle squashed.
      const stretch=reduced?0:clamp((ball.x-before[i][0]-ball.y+before[i][1])*.012+(ball.r-before[i][2])*.016,-.045,.045);
      ball.element.style.width=ball.element.style.height=(ball.r*2)+'px';
      ball.element.style.setProperty('--sphere-diameter',(ball.r*2)+'px');
      ball.element.style.transform=`translate3d(${ball.x-ball.r}px,${ball.y-ball.r}px,0) scale(${1+stretch},${1/(1+stretch)})`;
      if (expanded === ball.q) updateOverflow(ball);
    });
    quietFrames=movement<.03?quietFrames+1:0;
    if (quietFrames<45) frame=requestAnimationFrame(tick);
    else lastTime=0;
  }
  balls.forEach(ball => {
    ball.element.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse')arm(ball.q);},{signal:abort.signal});
    ball.element.addEventListener('pointerleave',()=>release(ball.q),{signal:abort.signal});
    ball.element.addEventListener('focusin',()=>arm(ball.q),{signal:abort.signal});
    ball.element.addEventListener('focusout',event=>{if(!ball.element.contains(event.relatedTarget))release(ball.q);},{signal:abort.signal});
    const list=ball.preview.querySelector('.sphere-task-list'),more=ball.preview.querySelector('.sphere-more');
    list.addEventListener('scroll',()=>updateOverflow(ball),{passive:true,signal:abort.signal});
    more.addEventListener('click',event=>{event.stopPropagation();list.scrollBy({top:list.clientHeight*.75,behavior:reduced?'auto':'smooth'});},{signal:abort.signal});
  });
  stage.addEventListener('pointermove',event=>{
    if(event.pointerType!=='mouse')return;
    const box=stage.getBoundingClientRect();
    pointer.x=event.clientX-box.left;pointer.y=event.clientY-box.top;pointer.active=true;wake();
  },{passive:true,signal:abort.signal});
  stage.addEventListener('pointerleave',()=>{pointer.active=false;clearTimeout(hoverTimer);hovered=-1;release(expanded);wake();},{signal:abort.signal});
  const observer=new ResizeObserver(resize);
  observer.observe(stage);
  function cleanup(){abort.abort();observer.disconnect();cancelAnimationFrame(frame);clearTimeout(hoverTimer);clearTimeout(leaveTimer);}
  quadrantSphereCleanup=cleanup;
  resize();
}
