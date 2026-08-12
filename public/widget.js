/**
 * AIbooking.dk embeddable widget loader.
 *
 * Usage:
 *   <script src="https://aibooking.dk/widget.js" data-widget-id="PUBLIC_WIDGET_ID"></script>
 *
 * This file never contains or receives any API keys — it only talks to the
 * platform's own /api/widget/* endpoints, which are the only code paths
 * allowed to touch Anthropic/ElevenLabs/Stripe credentials.
 */
(function () {
  "use strict";

  var currentScript =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (scripts[i].src && scripts[i].src.indexOf("widget.js") !== -1) return scripts[i];
      }
      return null;
    })();

  if (!currentScript) return;

  var publicId = currentScript.getAttribute("data-widget-id");
  if (!publicId) {
    console.error("[aibooking] widget.js: missing data-widget-id attribute");
    return;
  }

  var apiBase = new URL(currentScript.src).origin;
  var state = { sessionId: null, conversationId: null, config: null, open: false };

  function apiFetch(path, options) {
    return fetch(apiBase + path, options).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () {
          return {};
        }).then(function (body) {
          var err = new Error((body && body.error && body.error.message) || "Request failed");
          err.status = res.status;
          throw err;
        });
      }
      return res.json();
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        if (key === "style") node.style.cssText = attrs[key];
        else if (key.indexOf("on") === 0) node.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
        else node.setAttribute(key, attrs[key]);
      });
    }
    (children || []).forEach(function (child) {
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function buildUI(config) {
    var positionStyles = {
      "bottom-right": "bottom:20px;right:20px;",
      "bottom-left": "bottom:20px;left:20px;",
      "top-right": "top:20px;right:20px;",
      "top-left": "top:20px;left:20px;",
    };
    var pos = positionStyles[config.position] || positionStyles["bottom-right"];

    var launcher = el(
      "button",
      {
        id: "aibooking-launcher",
        style:
          "position:fixed;" +
          pos +
          "width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;" +
          "background:" +
          config.primaryColor +
          ";color:#fff;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:999999;",
      },
      ["💬"]
    );

    var messagesEl = el("div", {
      id: "aibooking-messages",
      style: "flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;",
    });

    var input = el("input", {
      type: "text",
      placeholder: "Skriv en besked...",
      style: "flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:14px;",
    });

    var sendBtn = el(
      "button",
      {
        style:
          "border:none;background:" + config.primaryColor + ";color:#fff;border-radius:8px;padding:8px 12px;cursor:pointer;",
      },
      ["Send"]
    );

    var panel = el(
      "div",
      {
        id: "aibooking-panel",
        style:
          "position:fixed;" +
          pos +
          "width:340px;max-width:90vw;height:460px;max-height:70vh;margin-bottom:76px;" +
          "background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.2);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        el(
          "div",
          {
            style:
              "background:" +
              config.secondaryColor +
              ";color:#fff;padding:14px 16px;font-weight:600;display:flex;align-items:center;gap:8px;",
          },
          [config.businessName || "AI-assistent"]
        ),
        messagesEl,
        el("div", { style: "display:flex;gap:8px;padding:10px;border-top:1px solid #eee;" }, [input, sendBtn]),
        config.showBranding
          ? el(
              "div",
              { style: "text-align:center;font-size:11px;color:#999;padding:4px 0 8px;" },
              ["Powered by AIbooking.dk"]
            )
          : el("div", {}, []),
      ]
    );

    document.body.appendChild(panel);
    document.body.appendChild(launcher);

    function addMessage(text, role) {
      var bubble = el(
        "div",
        {
          style:
            "max-width:80%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.4;" +
            (role === "user"
              ? "align-self:flex-end;background:" + config.primaryColor + ";color:#fff;"
              : "align-self:flex-start;background:#f1f1f1;color:#222;"),
        },
        [text]
      );
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function playAudio(base64, contentType) {
      try {
        var audio = new Audio("data:" + contentType + ";base64," + base64);
        audio.play().catch(function () {});
      } catch (e) {
        // Autoplay/audio errors should never break the text conversation.
      }
    }

    function ensureSession() {
      if (state.sessionId) return Promise.resolve();
      return apiFetch("/api/widget/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: publicId }),
      }).then(function (data) {
        state.sessionId = data.sessionId;
        state.conversationId = data.conversationId;
        if (data.openingMessage) addMessage(data.openingMessage, "assistant");
      });
    }

    function endSessionBeacon() {
      if (!state.sessionId) return;
      var payload = JSON.stringify({ sessionId: state.sessionId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(apiBase + "/api/widget/session", new Blob([payload], { type: "application/json" }));
      }
    }

    window.addEventListener("beforeunload", endSessionBeacon);

    function send() {
      var text = input.value.trim();
      if (!text) return;
      input.value = "";
      addMessage(text, "user");

      ensureSession()
        .then(function () {
          return apiFetch("/api/widget/message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: state.sessionId,
              conversationId: state.conversationId,
              message: text,
            }),
          });
        })
        .then(function (data) {
          addMessage(data.reply, "assistant");
          if (data.audioBase64) playAudio(data.audioBase64, data.audioContentType);
        })
        .catch(function (err) {
          var message =
            err.status === 402
              ? "Denne assistent er midlertidigt utilgængelig."
              : "Der opstod en fejl. Prøv igen om lidt.";
          addMessage(message, "assistant");
        });
    }

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send();
    });

    launcher.addEventListener("click", function () {
      state.open = !state.open;
      panel.style.display = state.open ? "flex" : "none";
      if (state.open) ensureSession();
    });
  }

  // "Expert model" widgets are speech-to-speech via OpenAI's Realtime API,
  // connected directly from the browser over WebRTC (never through our
  // server — see lib/realtime/openai-realtime.ts for the ephemeral token
  // this depends on). This is a voice-first UI: a call button instead of a
  // text input, and a live transcript fed by the WebRTC data channel.
  function buildRealtimeUI(config) {
    var positionStyles = {
      "bottom-right": "bottom:20px;right:20px;",
      "bottom-left": "bottom:20px;left:20px;",
      "top-right": "top:20px;right:20px;",
      "top-left": "top:20px;left:20px;",
    };
    var pos = positionStyles[config.position] || positionStyles["bottom-right"];

    var launcher = el(
      "button",
      {
        id: "aibooking-launcher",
        style:
          "position:fixed;" +
          pos +
          "width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;" +
          "background:" +
          config.primaryColor +
          ";color:#fff;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:999999;",
      },
      ["🎙"]
    );

    var transcriptEl = el("div", {
      id: "aibooking-transcript",
      style: "flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;",
    });

    var statusEl = el(
      "div",
      { style: "font-size:13px;color:#666;text-align:center;padding:4px 0 10px;" },
      ["Klik på mikrofonen for at starte samtalen"]
    );

    var callBtn = el(
      "button",
      {
        style:
          "width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;display:block;margin:0 auto;" +
          "background:" +
          config.primaryColor +
          ";color:#fff;font-size:26px;",
      },
      ["🎙"]
    );

    var panel = el(
      "div",
      {
        id: "aibooking-panel",
        style:
          "position:fixed;" +
          pos +
          "width:340px;max-width:90vw;height:460px;max-height:70vh;margin-bottom:76px;" +
          "background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.2);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        el(
          "div",
          {
            style:
              "background:" +
              config.secondaryColor +
              ";color:#fff;padding:14px 16px;font-weight:600;display:flex;align-items:center;gap:8px;",
          },
          [config.businessName || "AI-assistent"]
        ),
        transcriptEl,
        el("div", { style: "padding:12px;border-top:1px solid #eee;" }, [callBtn, statusEl]),
        config.showBranding
          ? el(
              "div",
              { style: "text-align:center;font-size:11px;color:#999;padding:0 0 8px;" },
              ["Powered by AIbooking.dk"]
            )
          : el("div", {}, []),
      ]
    );

    document.body.appendChild(panel);
    document.body.appendChild(launcher);

    function addTranscriptLine(text, role) {
      var bubble = el(
        "div",
        {
          style:
            "max-width:80%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.4;" +
            (role === "user"
              ? "align-self:flex-end;background:" + config.primaryColor + ";color:#fff;"
              : "align-self:flex-start;background:#f1f1f1;color:#222;"),
        },
        [text]
      );
      transcriptEl.appendChild(bubble);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    var rtc = { pc: null, dc: null, micStream: null, audioEl: null, startedAt: null, active: false };

    function teardownConnection() {
      if (rtc.pc) {
        try {
          rtc.pc.getSenders().forEach(function (sender) {
            if (sender.track) sender.track.stop();
          });
          rtc.pc.close();
        } catch (e) {}
      }
      if (rtc.micStream) {
        rtc.micStream.getTracks().forEach(function (track) {
          track.stop();
        });
      }
      if (rtc.audioEl && rtc.audioEl.parentNode) {
        rtc.audioEl.parentNode.removeChild(rtc.audioEl);
      }
      rtc.pc = null;
      rtc.dc = null;
      rtc.micStream = null;
      rtc.audioEl = null;
    }

    function endCall() {
      if (!rtc.active) return;
      rtc.active = false;
      var durationSeconds = rtc.startedAt ? (Date.now() - rtc.startedAt) / 1000 : 0;
      teardownConnection();
      statusEl.textContent = "Samtalen er afsluttet";
      callBtn.textContent = "🎙";

      if (state.sessionId) {
        var sessionId = state.sessionId;
        state.sessionId = null;
        apiFetch("/api/widget/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId, clientMeasuredDurationSeconds: durationSeconds }),
        }).catch(function () {});
      }
    }

    function handleDataChannelMessage(event) {
      var payload;
      try {
        payload = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      if (payload.type === "response.audio_transcript.done" && payload.transcript) {
        addTranscriptLine(payload.transcript, "assistant");
      } else if (
        payload.type === "conversation.item.input_audio_transcription.completed" &&
        payload.transcript
      ) {
        addTranscriptLine(payload.transcript, "user");
      } else if (payload.type === "error") {
        statusEl.textContent = "Der opstod en fejl under samtalen.";
      }
    }

    function openWebRTC(sessionData) {
      var realtime = sessionData.realtime;
      if (!realtime || !realtime.clientSecret) {
        return Promise.reject(new Error("Realtime session unavailable"));
      }

      return navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(function (micStream) {
          var pc = new RTCPeerConnection();
          var audioEl = document.createElement("audio");
          audioEl.autoplay = true;
          document.body.appendChild(audioEl);

          pc.ontrack = function (event) {
            audioEl.srcObject = event.streams[0];
          };

          micStream.getTracks().forEach(function (track) {
            pc.addTrack(track, micStream);
          });

          var dc = pc.createDataChannel("oai-events");
          dc.onmessage = handleDataChannelMessage;

          rtc.pc = pc;
          rtc.dc = dc;
          rtc.micStream = micStream;
          rtc.audioEl = audioEl;

          return pc.createOffer().then(function (offer) {
            return pc.setLocalDescription(offer).then(function () {
              return offer;
            });
          });
        })
        .then(function (offer) {
          return fetch("https://api.openai.com/v1/realtime?model=" + encodeURIComponent(realtime.model), {
            method: "POST",
            body: offer.sdp,
            headers: {
              Authorization: "Bearer " + realtime.clientSecret,
              "Content-Type": "application/sdp",
            },
          });
        })
        .then(function (sdpResponse) {
          if (!sdpResponse.ok) throw new Error("WebRTC handshake with OpenAI failed");
          return sdpResponse.text();
        })
        .then(function (answerSdp) {
          return rtc.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
        })
        .then(function () {
          rtc.active = true;
          rtc.startedAt = Date.now();
          statusEl.textContent = "Forbundet — I taler nu sammen";
          callBtn.textContent = "⏹";
        });
    }

    function startCall() {
      statusEl.textContent = "Forbinder...";
      apiFetch("/api/widget/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: publicId }),
      })
        .then(function (data) {
          state.sessionId = data.sessionId;
          state.conversationId = data.conversationId;
          return openWebRTC(data);
        })
        .catch(function (err) {
          teardownConnection();
          statusEl.textContent =
            err.status === 402 ? "Ikke flere minutter tilgængelige lige nu." : "Kunne ikke forbinde. Prøv igen.";
        });
    }

    callBtn.addEventListener("click", function () {
      if (rtc.active) endCall();
      else startCall();
    });

    window.addEventListener("beforeunload", function () {
      if (rtc.active) endCall();
    });

    launcher.addEventListener("click", function () {
      state.open = !state.open;
      panel.style.display = state.open ? "flex" : "none";
    });
  }

  fetch(apiBase + "/api/widget/config?publicId=" + encodeURIComponent(publicId))
    .then(function (res) {
      if (!res.ok) throw new Error("widget config unavailable");
      return res.json();
    })
    .then(function (data) {
      state.config = data.config;
      if (data.config.mode === "realtime") buildRealtimeUI(data.config);
      else buildUI(data.config);
    })
    .catch(function (err) {
      console.error("[aibooking] failed to load widget config:", err);
    });
})();
