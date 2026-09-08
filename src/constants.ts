// Rev154 (Carlos): shared numeric constants that used to be
// duplicated as literals across doctor.ts / kpis.ts / servo-health.ts.
// Keeping a single source of truth so a policy change (e.g. move to
// 0.5 A for a bigger servo) does not miss one of the callers.

/**
 * Servo current above which we consider the drive to be "on".
 * Below this the servo is idle (or noise from the ADC) and the
 * historian tick should NOT count toward runtime / duty / energy.
 * Same threshold used by:
 *  - Doctor authority analysis (servoOn ratio)
 *  - KPIs servo runtime + duty cycle + amp-hour integration
 *  - ServoHealth baseline learner (only counts on-load samples)
 */
export const SERVO_ON_MIN_A = 0.3;
