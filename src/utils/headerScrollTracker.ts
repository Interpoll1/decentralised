/** Direction hysteresis keeps subpixel scroll jitter from flashing the header. */
export function createHeaderScrollTracker() {
  let hidden = false;
  let previousTop = 0;
  let direction = 0;
  let turnTop = 0;

  return (scrollTop: number): boolean => {
    if (!Number.isFinite(scrollTop)) return hidden;
    const top = Math.max(0, scrollTop);

    if (top <= 8) {
      hidden = false;
      previousTop = turnTop = top;
      direction = 0;
      return hidden;
    }

    const delta = top - previousTop;
    if (delta === 0) return hidden;
    const nextDirection = Math.sign(delta);
    if (nextDirection !== direction) {
      direction = nextDirection;
      turnTop = previousTop;
    }

    if (!hidden && direction > 0 && top > 50 && top - turnTop >= 12) {
      hidden = true;
    } else if (hidden && direction < 0 && turnTop - top >= 12) {
      hidden = false;
    }
    previousTop = top;
    return hidden;
  };
}
