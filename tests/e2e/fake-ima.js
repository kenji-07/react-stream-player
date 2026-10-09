// Deterministic stand-in for the Google IMA HTML5 SDK used to test the
// package's IMA bridge (event mapping, content pause/resume, precedence).
// It implements only the API surface the package uses. Behaviour is selected
// by the ad tag URL query: ?scenario=success|nofill|malformed|timeout|managererror
// &cues=0,5,-1 (seconds; 0 = preroll, -1 = postroll) &adDuration=1.5
(function () {
  const calls = (window.__imaCalls = []);
  const T = {
    CONTENT_PAUSE_REQUESTED: 'contentPauseRequested',
    CONTENT_RESUME_REQUESTED: 'contentResumeRequested',
    ALL_ADS_COMPLETED: 'allAdsCompleted',
    STARTED: 'start',
    COMPLETE: 'complete',
    SKIPPED: 'skip',
    CLICK: 'click',
    AD_PROGRESS: 'adProgress',
    PAUSED: 'pause',
    RESUMED: 'resume',
    LOADED: 'loaded',
  };
  class Emitter {
    constructor() {
      this.l = {};
    }
    addEventListener(type, fn) {
      (this.l[type] ||= []).push(fn);
    }
    fire(type, event) {
      for (const fn of this.l[type] || []) fn(event);
    }
  }
  function err(code) {
    return { getError: () => ({ getErrorCode: () => code, getMessage: () => `fake error ${code}`, getType: () => 'adLoadError' }) };
  }
  class AdDisplayContainer {
    constructor(container, video) {
      this.container = container;
      calls.push(['AdDisplayContainer', Boolean(container), Boolean(video)]);
    }
    initialize() {
      calls.push(['initialize']);
    }
    destroy() {
      calls.push(['adc.destroy']);
    }
  }
  class AdsRequest {
    constructor() {
      this.adTagUrl = '';
      this.vastLoadTimeout = 5000;
    }
    setAdWillAutoPlay(v) {
      this.autoPlay = v;
    }
    setAdWillPlayMuted(v) {
      this.muted = v;
    }
  }
  class AdsRenderingSettings {
    constructor() {
      this.loadVideoTimeout = -1;
      this.mimeTypes = null;
      this.restoreCustomPlaybackStateOnAdBreakComplete = false;
    }
  }
  class AdsManager extends Emitter {
    constructor(content, opts) {
      super();
      this.content = content;
      this.opts = opts;
      this.cues = opts.cues;
      this.played = new Set();
      this.inBreak = false;
      this.paused = false;
      this.destroyed = false;
    }
    getCuePoints() {
      return this.cues.slice();
    }
    getAdSkippableState() {
      return true;
    }
    getRemainingTime() {
      return 0;
    }
    init(w, h) {
      calls.push(['init', w, h]);
    }
    setVolume(v) {
      calls.push(['setVolume', v]);
    }
    resize(w, h) {
      calls.push(['resize', w, h]);
    }
    pause() {
      this.paused = true;
      calls.push(['pause']);
    }
    resume() {
      this.paused = false;
      calls.push(['resume']);
    }
    skip() {
      calls.push(['skip']);
    }
    destroy() {
      this.destroyed = true;
      clearInterval(this.watch);
      calls.push(['manager.destroy']);
    }
    start() {
      calls.push(['start']);
      if (this.cues.length === 0 || this.cues.includes(0)) this.playBreak(0);
      this.watch = setInterval(() => {
        if (this.inBreak || this.destroyed) return;
        for (const cue of this.cues) {
          if (cue > 0 && !this.played.has(cue) && this.content.currentTime >= cue) this.playBreak(cue);
        }
      }, 100);
    }
    contentComplete() {
      if (this.cues.includes(-1) && !this.played.has(-1)) this.playBreak(-1);
      else this.fire(T.ALL_ADS_COMPLETED, { type: T.ALL_ADS_COMPLETED });
    }
    playBreak(cue) {
      this.played.add(cue);
      this.inBreak = true;
      const id = `fake-ad-${cue}`;
      const ad = {
        getAdId: () => id,
        getTitle: () => 'Fake <b>ad</b>',
        getDuration: () => this.opts.adDuration,
        getContentType: () => 'video/mp4',
        isLinear: () => true,
        getSkipTimeOffset: () => 1,
        getAdPodInfo: () => ({ getTimeOffset: () => cue, getAdPosition: () => 1, getTotalAds: () => 1 }),
      };
      const ev = (type) => ({ type, getAd: () => ad, getAdData: () => null });
      this.fire(T.CONTENT_PAUSE_REQUESTED, ev(T.CONTENT_PAUSE_REQUESTED));
      const box = document.createElement('div');
      box.className = 'fake-ima-ad';
      box.textContent = `FAKE IMA AD ${cue}`;
      this.opts.container.appendChild(box);
      this.fire(T.LOADED, ev(T.LOADED));
      this.fire(T.STARTED, ev(T.STARTED));
      let t = 0;
      const tick = setInterval(() => {
        if (this.destroyed) return clearInterval(tick);
        if (this.paused) return;
        t += 0.25;
        this.fire(T.AD_PROGRESS, { type: T.AD_PROGRESS, getAd: () => ad, getAdData: () => ({ currentTime: t, duration: this.opts.adDuration }) });
        if (this.opts.scenario === 'managererror' && t >= 0.5) {
          clearInterval(tick);
          box.remove();
          this.inBreak = false;
          this.fire('adError', err(405));
          return;
        }
        if (t >= this.opts.adDuration) {
          clearInterval(tick);
          box.remove();
          this.fire(T.COMPLETE, ev(T.COMPLETE));
          this.inBreak = false;
          this.fire(T.CONTENT_RESUME_REQUESTED, ev(T.CONTENT_RESUME_REQUESTED));
          const remaining = this.cues.filter((c) => !this.played.has(c));
          if (remaining.length === 0 || (cue === -1 && remaining.every((c) => c !== -1))) this.fire(T.ALL_ADS_COMPLETED, { type: T.ALL_ADS_COMPLETED });
        }
      }, 250);
    }
  }
  class AdsLoader extends Emitter {
    constructor(adc) {
      super();
      this.adc = adc;
      calls.push(['AdsLoader']);
    }
    requestAds(request) {
      const url = new URL(request.adTagUrl, location.href);
      const scenario = url.searchParams.get('scenario') || 'success';
      const cues = (url.searchParams.get('cues') || '0').split(',').filter(Boolean).map(Number);
      const adDuration = Number(url.searchParams.get('adDuration') || '1.5');
      calls.push(['requestAds', request.adTagUrl, request.vastLoadTimeout, request.autoPlay, request.muted]);
      const delay = scenario === 'timeout' ? request.vastLoadTimeout : 80;
      setTimeout(() => {
        if (scenario === 'nofill') return this.fire('adError', err(1009));
        if (scenario === 'malformed') return this.fire('adError', err(100));
        if (scenario === 'timeout') return this.fire('adError', err(301));
        const container = this.adc.container;
        this.manager = null;
        this.fire('adsManagerLoaded', {
          getAdsManager: (content, settings) => {
            calls.push(['getAdsManager', content instanceof HTMLVideoElement, settings && settings.loadVideoTimeout]);
            this.manager = new AdsManager(content, { scenario, cues, adDuration, container });
            return this.manager;
          },
        });
      }, delay);
    }
    contentComplete() {
      calls.push(['contentComplete']);
      this.manager && this.manager.contentComplete();
    }
    destroy() {
      calls.push(['loader.destroy']);
    }
  }
  window.google = window.google || {};
  window.google.ima = {
    AdDisplayContainer,
    AdsLoader,
    AdsRequest,
    AdsRenderingSettings,
    AdsManagerLoadedEvent: { Type: { ADS_MANAGER_LOADED: 'adsManagerLoaded' } },
    AdErrorEvent: { Type: { AD_ERROR: 'adError' } },
    AdEvent: { Type: T },
    ViewMode: { NORMAL: 'normal' },
  };
})();
