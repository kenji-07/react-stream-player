// Deterministic stand-in for the Google Cast Web Sender SDK (CAF), served in
// place of cast_sender.js. It implements only the API surface the package uses
// and simulates one available device. It verifies the package's sender logic
// (status mapping, LOAD request, local pause/resume, rejection reasons) — not
// real Cast behaviour, which stays externally unverified.
(function () {
  const log = (window.__castLog = { options: null, loads: [], ended: 0 });
  const CastState = { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE', NOT_CONNECTED: 'NOT_CONNECTED', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED' };
  const SessionState = { SESSION_STARTING: 'SESSION_STARTING', SESSION_STARTED: 'SESSION_STARTED', SESSION_RESUMED: 'SESSION_RESUMED', SESSION_ENDED: 'SESSION_ENDED' };
  const CastContextEventType = { CAST_STATE_CHANGED: 'caststatechanged', SESSION_STATE_CHANGED: 'sessionstatechanged' };
  const RemotePlayerEventType = { IS_CONNECTED_CHANGED: 'isConnectedChanged', CURRENT_TIME_CHANGED: 'currentTimeChanged', IS_PAUSED_CHANGED: 'isPausedChanged' };

  class Emitter {
    constructor() {
      this.l = {};
    }
    addEventListener(type, fn) {
      (this.l[type] ||= []).push(fn);
    }
    removeEventListener(type, fn) {
      this.l[type] = (this.l[type] || []).filter((f) => f !== fn);
    }
    fire(type, event) {
      for (const fn of [...(this.l[type] || [])]) fn(event);
    }
  }

  const remote = { isConnected: false, currentTime: 0, isPaused: true };
  const controllers = [];
  class RemotePlayer {
    constructor() {
      return remote;
    }
  }
  class RemotePlayerController extends Emitter {
    constructor() {
      super();
      controllers.push(this);
    }
    playOrPause() {}
    seek() {}
  }

  let state = CastState.NOT_CONNECTED;
  let session = null;
  const context = new (class extends Emitter {
    setOptions(options) {
      log.options = options;
    }
    getCastState() {
      return state;
    }
    getCurrentSession() {
      return session;
    }
    async requestSession() {
      setState(CastState.CONNECTING);
      session = {
        getCastDevice: () => ({ friendlyName: 'Fake TV' }),
        loadMedia: async (request) => {
          log.loads.push({ contentId: request.media.contentId, contentType: request.media.contentType, currentTime: request.currentTime, autoplay: request.autoplay, hasCustomData: request.customData !== undefined });
          remote.currentTime = request.currentTime;
          remote.isPaused = !request.autoplay;
        },
        endSession: () => {
          log.ended++;
          session = null;
          remote.isConnected = false;
          setState(CastState.NOT_CONNECTED);
          context.fire(CastContextEventType.SESSION_STATE_CHANGED, { sessionState: SessionState.SESSION_ENDED });
        },
      };
      remote.isConnected = true;
      setState(CastState.CONNECTED);
      context.fire(CastContextEventType.SESSION_STATE_CHANGED, { sessionState: SessionState.SESSION_STARTED });
    }
  })();
  function setState(next) {
    state = next;
    context.fire(CastContextEventType.CAST_STATE_CHANGED, { castState: next });
  }

  // Test hook: the remote player advanced to `time` and is playing/paused.
  window.__castRemote = (time, paused) => {
    remote.currentTime = time;
    remote.isPaused = paused;
    for (const c of controllers) {
      c.fire(RemotePlayerEventType.CURRENT_TIME_CHANGED, {});
      c.fire(RemotePlayerEventType.IS_PAUSED_CHANGED, {});
    }
  };

  window.cast = { framework: { CastContext: { getInstance: () => context }, CastContextEventType, SessionState, CastState, RemotePlayer, RemotePlayerController, RemotePlayerEventType } };
  window.chrome = window.chrome || {};
  window.chrome.cast = {
    media: {
      MediaInfo: function (contentId, contentType) {
        this.contentId = contentId;
        this.contentType = contentType;
      },
      LoadRequest: function (media) {
        this.media = media;
      },
    },
    AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' },
  };
  setTimeout(() => window.__onGCastApiAvailable && window.__onGCastApiAvailable(true), 0);
})();
