// EMBERLINE — keyboard + mouse. Pointer lock owns the mouse; the module
// only exposes a snapshot (keys held, look delta since last read, firing).
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    lookX: 0,
    lookY: 0,
    firing: false,
    locked: false,
  };

  function onKeyDown(e) {
    if (e.repeat) return;
    state.keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  }
  function onKeyUp(e) { state.keys.delete(e.code); }
  function onMouseMove(e) {
    if (!state.locked) return;
    state.lookX += e.movementX;
    state.lookY += e.movementY;
  }
  function onMouseDown(e) {
    if (e.button === 0) state.firing = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) state.firing = false;
  }
  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) state.firing = false;
    if (onLockChange) onLockChange(state.locked);
  }
  function onBlur() {
    state.keys.clear();
    state.firing = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onLock);

  return {
    state,
    requestLock() { canvas.requestPointerLock(); },
    releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
  };
}
