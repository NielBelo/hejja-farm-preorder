export const BACKGROUND_TRAVEL_RATIO = 0.4;
const DECELERATION_START = 0.55;

function easeIntoBoundary(progress: number) {
    if (progress <= DECELERATION_START) return progress;

    const remaining = 1 - DECELERATION_START;
    const localProgress = (progress - DECELERATION_START) / remaining;
    // Folytonos sebességgel indul, majd a határnál nullára lassul.
    const easedProgress = localProgress + localProgress ** 2 - localProgress ** 3;
    return DECELERATION_START + remaining * easedProgress;
}

export function getBackgroundMotion(
    scrollY: number,
    viewportHeight: number,
    reducedMotion = false
) {
    const travel = Math.max(viewportHeight, 0) * BACKGROUND_TRAVEL_RATIO;
    const safeScroll = Math.max(scrollY, 0);

    const progress = travel > 0 ? Math.min(safeScroll / travel, 1) : 0;

    return {
        offset: reducedMotion ? 0 : travel * easeIntoBoundary(progress),
        settled: !reducedMotion && travel > 0 && safeScroll >= travel - 1,
    };
}
