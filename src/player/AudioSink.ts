import * as mobx from "mobx";

export type TrackStatus = "playing" | "paused" | "complete";

export interface AudioSink {
  /** Sets an audio track to play */
  setMedia(data: ArrayBuffer): Promise<void>;
  /** play the current audio */
  play(): void;
  /** pause the current audio */
  pause(): void;
  /** move the audio to the beginning of the track */
  restart(): void;
  /** observable for the currently playing track status */
  readonly trackStatus: TrackStatus;
  /** Web Audio stuff, for observing the audio state, like visualization */
  // readonly source: AudioNode | undefined;
  // readonly context: AudioContext | undefined;
  readonly audio?: HTMLAudioElement;
}

export class WebAudioSink implements AudioSink {
  _trackStatus: TrackStatus = "paused";

  _completionChecker?: ReturnType<typeof setTimeout> = undefined;
  _lastActivePlayPosition = 0;
  public _audio: HTMLAudioElement;
  private _audioSource: MediaSource;
  private _sourceBuffer: SourceBuffer;

  get audio(): HTMLAudioElement | undefined {
    return this._audio;
  }

  static async create(): Promise<WebAudioSink> {
    const audioSource = window.ManagedMediaSource
      ? new window.ManagedMediaSource()
      : new window.MediaSource();
    const audio = new Audio();
    // required for ManagedMediaSource to open
    audio.disableRemotePlayback = true;
    audio.controls = true;

    // end required for ManagedMediaSource to open
    audio.src = URL.createObjectURL(audioSource);
    await once("sourceopen", audioSource!);

    audio.playbackRate = 2;
    const sourceBuffer = audioSource!.addSourceBuffer("audio/mpeg");
    await onceBuffUpdateEnd(sourceBuffer);
    const sink = new WebAudioSink(audio, audioSource, sourceBuffer);
    return sink;
  }

  constructor(
    _audio: HTMLAudioElement,
    _audioSource: MediaSource,
    _sourceBuffer: SourceBuffer,
  ) {
    this._audio = _audio;
    this._audioSource = _audioSource;
    this._sourceBuffer = _sourceBuffer;
    mobx.makeObservable(this, {
      _trackStatus: mobx.observable,
      _audio: mobx.observable,
      audio: mobx.computed,
      play: mobx.action,
      pause: mobx.action,
      restart: mobx.action,
      trackStatus: mobx.computed,
      _updateTrackStatus: mobx.action,
    });
  }

  get trackStatus(): TrackStatus {
    return this._trackStatus;
  }

  private getTrackStatus() {
    const position = this._audio.currentTime;
    const duration = this._sourceBuffer!.buffered.end(
      this._sourceBuffer!.buffered.length - 1,
    );
    let safemargin = 0;
    if (this._lastActivePlayPosition === position) {
      safemargin = 0.5;
    } else {
      this._lastActivePlayPosition = position;
    }
    if (position >= duration - safemargin) {
      return "complete";
    } else if (this._audio.paused) {
      return "paused";
    } else {
      return "playing";
    }
  }

  _updateTrackStatus() {
    this._trackStatus = this.getTrackStatus();
  }

  async setMedia(data: ArrayBuffer): Promise<void> {
    await onceBuffUpdateEnd(this._sourceBuffer);
    if (this._sourceBuffer!.buffered.length > 0) {
      const end = this._sourceBuffer!.buffered.end(
        this._sourceBuffer!.buffered.length - 1,
      );
      this._sourceBuffer?.remove(0, end);
      this._audio!.currentTime = 0;
      await onceBuffUpdateEnd(this._sourceBuffer);
      this._sourceBuffer!.timestampOffset = 0;
      await onceBuffUpdateEnd(this._sourceBuffer);
    }
    this._sourceBuffer!.appendBuffer(data);
    await onceBuffUpdateEnd(this._sourceBuffer);
    this._updateTrackStatus();
  }

  play() {
    this._audio.play();
    this._updateTrackStatus();
    this._audio.onplay = () => this._updateTrackStatus();
    this.loopCheckCompletion();
  }

  private loopCheckCompletion() {
    clearTimeout(this._completionChecker);
    const sb = this._sourceBuffer!;
    const audio = this._audio!;
    const untilDone =
      sb.buffered.end(sb.buffered.length - 1) - audio.currentTime;
    const delay =
      (untilDone < 0.5 ? 100 : untilDone * 1000) /
      (this._audio?.playbackRate || 1);
    this._completionChecker = setTimeout(() => {
      const updated = this.getTrackStatus();
      if (updated !== this._trackStatus) {
        this._updateTrackStatus();
      }
      if (this._trackStatus === "playing") {
        this.loopCheckCompletion();
      }
    }, delay);
  }

  pause() {
    if (this._audio) {
      clearInterval(this._completionChecker);
      this._audio.pause();
      this._audio.onpause = () => this._updateTrackStatus();
    }
  }

  restart() {
    if (this._audio) {
      this._audio.currentTime = 0;
      this.play();
    }
  }
}

function once<S extends string>(
  event: S,
  emitter: {
    addEventListener: (event: S, listener: () => void) => void;
    removeEventListener: (event: S, listener: () => void) => void;
  },
) {
  return new Promise<void>((resolve, reject) => {
    const listener = () => {
      resolve();
      emitter.removeEventListener(event, listener);
    };
    emitter.addEventListener(event, listener);
  });
}

async function onceBuffUpdateEnd(sb: SourceBuffer) {
  if (sb.updating) {
    await once("updateend", sb);
  }
}
