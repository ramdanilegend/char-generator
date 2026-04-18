import type { BaseState, BodyAnimation, EyeState, MouthShape } from '@/types';

export interface CharacterState {
  base: BaseState;
  currentAnimation: BodyAnimation;
  mouth: MouthShape;
  eyes: EyeState;
  isBlinking: boolean;
}

type StateChangeListener = (state: CharacterState) => void;

/**
 * StateMachine
 *
 * Tracks the logical state of the character.
 * Base state (idle/gesture/listening) and overlay states (mouth, eyes) run independently.
 */
export class StateMachine {
  private state: CharacterState = {
    base: 'idle',
    currentAnimation: 'idle',
    mouth: 'rest',
    eyes: 'open',
    isBlinking: false,
  };

  private listeners: StateChangeListener[] = [];

  getState(): Readonly<CharacterState> {
    return { ...this.state };
  }

  // ---- Base state transitions ----

  setIdle() {
    this.patch({ base: 'idle', currentAnimation: 'idle' });
  }

  setListening() {
    this.patch({ base: 'listening', currentAnimation: 'idle' });
  }

  startGesture(animation: BodyAnimation) {
    this.patch({ base: 'gesture', currentAnimation: animation });
  }

  gestureComplete() {
    this.patch({ base: 'idle', currentAnimation: 'idle' });
  }

  // ---- Overlay state transitions ----

  setMouth(shape: MouthShape) {
    if (this.state.mouth !== shape) {
      this.patch({ mouth: shape });
    }
  }

  setEyes(state: EyeState) {
    if (this.state.eyes !== state) {
      this.patch({ eyes: state });
    }
  }

  triggerBlink() {
    if (this.state.isBlinking) return;
    this.patch({ isBlinking: true, eyes: 'close-1' });

    const phases = [
      { state: 'close-2', ms: 25 },
      { state: 'close-3', ms: 25 },
      { state: 'closed', ms: 30 },
      { state: 'close-3', ms: 30 },
      { state: 'close-2', ms: 25 },
      { state: 'close-1', ms: 25 },
      { state: 'open', ms: 30 },
    ];

    let delay = 30;
    for (let i = 0; i < phases.length; i++) {
        setTimeout(() => {
            const isLast = i === phases.length - 1;
            this.patch({
                eyes: phases[i].state as EyeState,
                isBlinking: !isLast
            });
        }, delay);
        delay += phases[i].ms;
    }
  }

  // ---- Subscriptions ----

  onChange(listener: StateChangeListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  private patch(partial: Partial<CharacterState>) {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((l) => l(this.state));
  }
}
