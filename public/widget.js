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

  // Shared by all three UI builders below (text chat, OpenAI Realtime, Vapi)
  // so the avatar/branding treatment stays identical across every widget
  // mode instead of drifting between three copies.
  function buildHeader(config) {
    var avatar = config.avatarUrl
      ? el("img", {
          src: config.avatarUrl,
          alt: "",
          style:
            "width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;" +
            "border:2px solid rgba(255,255,255,.35);",
        })
      : el(
          "div",
          {
            style:
              "width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;" +
              "justify-content:center;background:rgba(255,255,255,.18);font-size:14px;font-weight:600;",
          },
          [(config.businessName || "AI").trim().charAt(0).toUpperCase()]
        );

    return el(
      "div",
      {
        style:
          "background:" +
          config.secondaryColor +
          ";color:#fff;padding:14px 16px;font-weight:600;display:flex;align-items:center;gap:10px;",
      },
      [avatar, el("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" }, [config.businessName || "AI-assistent"])]
    );
  }

  // The round launcher button — the uploaded avatar when there is one
  // (cropped into the circle), the given emoji glyph otherwise.
  function buildLauncher(config, pos, glyph) {
    var baseStyle =
      "position:fixed;" +
      pos +
      "width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:999999;";

    if (config.avatarUrl) {
      return el("button", {
        id: "aibooking-launcher",
        style:
          baseStyle +
          "background-image:url('" +
          config.avatarUrl +
          "');background-size:cover;background-position:center;background-color:" +
          config.primaryColor +
          ";",
      });
    }

    return el(
      "button",
      {
        id: "aibooking-launcher",
        style: baseStyle + "background:" + config.primaryColor + ";color:#fff;font-size:24px;",
      },
      [glyph]
    );
  }

  // A mic button for the text-chat panel: dictate instead of type, using
  // the browser's own speech recognition (no server round-trip, no extra
  // provider — Chrome/Edge/Safari support it, Firefox doesn't, hence the
  // feature-detect and graceful "just don't show the button" fallback).
  // `onResult` receives the final transcript.
  function buildMicButton(config, language, onResult) {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return null;

    var recognition = new Recognition();
    recognition.lang = language;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    var listening = false;

    var micBtn = el(
      "button",
      {
        type: "button",
        title: "Tal i stedet for at skrive",
        style:
          "border:none;background:#f1f1f1;color:#555;border-radius:8px;padding:8px 10px;cursor:pointer;font-size:15px;",
      },
      ["🎤"]
    );

    recognition.onstart = function () {
      listening = true;
      micBtn.style.background = config.primaryColor;
      micBtn.style.color = "#fff";
    };
    recognition.onend = function () {
      listening = false;
      micBtn.style.background = "#f1f1f1";
      micBtn.style.color = "#555";
    };
    recognition.onresult = function (event) {
      var transcript = event.results[0] && event.results[0][0] && event.results[0][0].transcript;
      if (transcript) onResult(transcript);
    };
    recognition.onerror = function () {
      listening = false;
    };

    micBtn.addEventListener("click", function () {
      if (listening) {
        recognition.stop();
        return;
      }
      try {
        recognition.start();
      } catch (e) {
        // Already-started/permission errors — nothing useful to recover to.
      }
    });

    return micBtn;
  }

  function buildUI(config) {
    var positionStyles = {
      "bottom-right": "bottom:20px;right:20px;",
      "bottom-left": "bottom:20px;left:20px;",
      "top-right": "top:20px;right:20px;",
      "top-left": "top:20px;left:20px;",
    };
    var pos = positionStyles[config.position] || positionStyles["bottom-right"];

    var launcher = buildLauncher(config, pos, "💬");

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

    var speechLang = config.language === "en" ? "en-US" : "da-DK";
    var micBtn = buildMicButton(config, speechLang, function (transcript) {
      input.value = transcript;
      send();
    });

    var panel = el(
      "div",
      {
        id: "aibooking-panel",
        style:
          "position:fixed;" +
          pos +
          "width:340px;max-width:90vw;height:460px;max-height:70vh;margin-bottom:76px;" +
          "background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);" +
          "border:1px solid rgba(0,0,0,.06);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        buildHeader(config),
        messagesEl,
        el(
          "div",
          { style: "display:flex;gap:8px;padding:10px;border-top:1px solid #eee;" },
          micBtn ? [micBtn, input, sendBtn] : [input, sendBtn]
        ),
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

    var launcher = buildLauncher(config, pos, "🎙");

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
          "background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);" +
          "border:1px solid rgba(0,0,0,.06);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        buildHeader(config),
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
          console.error("[aibooking] Realtime widget failed to start:", err);
          teardownConnection();
          statusEl.textContent =
            err.status === 402
              ? "Ikke flere minutter tilgængelige lige nu."
              : "Kunne ikke forbinde (" + (err && err.message ? err.message : "ukendt fejl") + "). Prøv igen.";
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

  // "Vapi model" widgets are also speech-to-speech, but the call itself is
  // driven by the Vapi Web SDK (loaded from its CDN below) instead of us
  // negotiating WebRTC by hand like buildRealtimeUI does — see
  // lib/vapi/index.ts and app/api/webhooks/vapi/route.ts on the server side.
  //
  // Deliberately NOT @vapi-ai/web's own dist/vapi.js: that package's dist is
  // built with plain `tsc` (CommonJS, no bundler — verified against its
  // package.json), so loading it via a plain <script> tag never defines any
  // browser global — every call silently failed at loadVapiSdk() before this
  // ever reached Vapi. This is Vapi's own officially documented script-tag
  // bundle instead, a real IIFE build that exposes window.vapiSDK.run(),
  // which both sets up their own default floating button AND returns the
  // underlying call client (same start/stop/on API as @vapi-ai/web's Vapi
  // class) for programmatic use — we hide their button via its documented
  // .vapi-btn class since this widget already renders its own call UI.
  var VAPI_SDK_URL = "https://cdn.jsdelivr.net/gh/VapiAI/html-script-tag@latest/dist/assets/index.js";
  var vapiSdkPromise = null;

  function hideDefaultVapiButton() {
    if (document.getElementById("aibooking-vapi-hide-default-btn")) return;
    var style = document.createElement("style");
    style.id = "aibooking-vapi-hide-default-btn";
    style.textContent = ".vapi-btn{display:none!important;}";
    document.head.appendChild(style);
  }

  function loadVapiSdk() {
    if (vapiSdkPromise) return vapiSdkPromise;
    vapiSdkPromise = new Promise(function (resolve, reject) {
      if (window.vapiSDK) {
        resolve(window.vapiSDK);
        return;
      }
      var script = document.createElement("script");
      script.src = VAPI_SDK_URL;
      script.async = true;
      script.onload = function () {
        if (window.vapiSDK) resolve(window.vapiSDK);
        else reject(new Error("Vapi SDK loaded but window.vapiSDK is missing"));
      };
      script.onerror = function () {
        reject(new Error("Failed to load Vapi SDK"));
      };
      document.head.appendChild(script);
    });
    return vapiSdkPromise;
  }

  function buildVapiUI(config) {
    var positionStyles = {
      "bottom-right": "bottom:20px;right:20px;",
      "bottom-left": "bottom:20px;left:20px;",
      "top-right": "top:20px;right:20px;",
      "top-left": "top:20px;left:20px;",
    };
    var pos = positionStyles[config.position] || positionStyles["bottom-right"];

    var launcher = buildLauncher(config, pos, "🎙");

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
          "background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);" +
          "border:1px solid rgba(0,0,0,.06);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        buildHeader(config),
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

    var call = { client: null, active: false, startedAt: null };

    // All end-of-call bookkeeping (duration, billing PATCH, UI reset) lives
    // here and only here — the call button just tells the SDK to stop,
    // whether the user hangs up or the assistant/Vapi ends the call first,
    // both paths converge on the SDK's own "call-end" event.
    function handleCallEnd() {
      if (!call.active) return;
      call.active = false;
      var durationSeconds = call.startedAt ? (Date.now() - call.startedAt) / 1000 : 0;
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

    function handleMessage(message) {
      if (message && message.type === "transcript" && message.transcriptType === "final" && message.transcript) {
        addTranscriptLine(message.transcript, message.role === "user" ? "user" : "assistant");
      }
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
          if (!data.vapi || !data.vapi.publicKey || !data.vapi.assistantId) {
            throw new Error("Vapi session unavailable");
          }
          return loadVapiSdk().then(function (vapiSDK) {
            if (!call.client) {
              hideDefaultVapiButton();
              call.client = vapiSDK.run({ apiKey: data.vapi.publicKey, assistant: data.vapi.assistantId, config: {} });
              call.client.on("call-start", function () {
                call.active = true;
                call.startedAt = Date.now();
                statusEl.textContent = "Forbundet — I taler nu sammen";
                callBtn.textContent = "⏹";
              });
              call.client.on("call-end", handleCallEnd);
              call.client.on("message", handleMessage);
              call.client.on("error", function (e) {
                // Vapi's error event shape isn't fixed (varies by failure
                // source — mic permissions, ICE negotiation, the assistant
                // itself) — surface whatever text it gives us instead of a
                // dead-end generic message, and always log the raw object so
                // it's visible in devtools even when no readable text exists.
                console.error("Vapi call error:", e);
                var detail =
                  (e && (e.message || e.errorMsg || (e.error && e.error.message))) || null;
                statusEl.textContent = detail
                  ? "Fejl: " + detail
                  : "Der opstod en fejl under samtalen (se browserkonsollen for detaljer).";
              });
            }
            call.client.start(data.vapi.assistantId);
          });
        })
        .catch(function (err) {
          // Anything here happens before call.client.start() is even
          // reached (session request, SDK script load, or vapiSDK.run()
          // itself throwing) — always log the real error so a failure is
          // diagnosable from the browser console instead of just the one
          // generic status line every failure used to collapse into.
          console.error("[aibooking] Vapi widget failed to start:", err);
          statusEl.textContent =
            err.status === 402
              ? "Ikke flere minutter tilgængelige lige nu."
              : "Kunne ikke forbinde (" + (err && err.message ? err.message : "ukendt fejl") + "). Prøv igen.";
        });
    }

    callBtn.addEventListener("click", function () {
      if (call.active) call.client.stop();
      else startCall();
    });

    window.addEventListener("beforeunload", function () {
      if (call.active && call.client) call.client.stop();
    });

    launcher.addEventListener("click", function () {
      state.open = !state.open;
      panel.style.display = state.open ? "flex" : "none";
    });
  }

  // "Twilio Relay" widgets are also speech-to-speech, but the call is
  // placed via the official Twilio Voice SDK (vendored locally — Twilio
  // stopped serving it via CDN as of v2.0, see public/vendor/README.md)
  // against our platform TwiML Application, which routes into
  // ConversationRelay server-side (see app/api/telephony/twilio/voice/
  // relay-start and relay-server/). Unlike Vapi's SDK, the Twilio Voice SDK
  // never exposes conversation transcripts to the browser — STT/TTS/routing
  // all happen between Twilio and relay-server — so this UI can only show
  // call status, not a live transcript.
  var TWILIO_SDK_PATH = "/vendor/twilio-voice-sdk.min.js";
  var twilioSdkPromise = null;

  function loadTwilioSdk() {
    if (twilioSdkPromise) return twilioSdkPromise;
    twilioSdkPromise = new Promise(function (resolve, reject) {
      if (window.Twilio && window.Twilio.Device) {
        resolve(window.Twilio);
        return;
      }
      var script = document.createElement("script");
      script.src = apiBase + TWILIO_SDK_PATH;
      script.async = true;
      script.onload = function () {
        if (window.Twilio && window.Twilio.Device) resolve(window.Twilio);
        else reject(new Error("Twilio Voice SDK loaded but window.Twilio.Device is missing"));
      };
      script.onerror = function () {
        reject(new Error("Failed to load Twilio Voice SDK"));
      };
      document.head.appendChild(script);
    });
    return twilioSdkPromise;
  }

  function buildTwilioRelayUI(config) {
    var positionStyles = {
      "bottom-right": "bottom:20px;right:20px;",
      "bottom-left": "bottom:20px;left:20px;",
      "top-right": "top:20px;right:20px;",
      "top-left": "top:20px;left:20px;",
    };
    var pos = positionStyles[config.position] || positionStyles["bottom-right"];

    var launcher = buildLauncher(config, pos, "🎙");

    var statusEl = el(
      "div",
      { style: "flex:1;display:flex;align-items:center;justify-content:center;font-size:14px;color:#666;text-align:center;padding:12px;" },
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
          "background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.22);" +
          "border:1px solid rgba(0,0,0,.06);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        buildHeader(config),
        statusEl,
        el("div", { style: "padding:12px;border-top:1px solid #eee;" }, [callBtn]),
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

    var call = { device: null, activeCall: null, active: false };

    // Billing is handled entirely server-side (relay-server measures the
    // real ConversationRelay connection duration and reports it to
    // /api/internal/conversation-relay/end when the call ends) — unlike the
    // realtime/Vapi UIs above, this handler never PATCHes /api/widget/session.
    function handleCallEnd() {
      if (!call.active) return;
      call.active = false;
      call.activeCall = null;
      statusEl.textContent = "Samtalen er afsluttet";
      callBtn.textContent = "🎙";
    }

    function startCall() {
      statusEl.textContent = "Forbinder...";
      apiFetch("/api/widget/relay-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicId: publicId }),
      })
        .then(function (data) {
          state.sessionId = data.sessionId;
          state.conversationId = data.conversationId;
          if (!data.token) throw new Error("Twilio Voice Relay token unavailable");

          return loadTwilioSdk().then(function (Twilio) {
            if (!call.device) {
              call.device = new Twilio.Device(data.token);
              call.device.on("error", function () {
                statusEl.textContent = "Der opstod en fejl under samtalen.";
              });
            } else {
              call.device.updateToken(data.token);
            }
            return call.device.connect({
              params: { publicId: publicId, sessionId: data.sessionId, conversationId: data.conversationId },
            });
          });
        })
        .then(function (twilioCall) {
          call.activeCall = twilioCall;
          twilioCall.on("accept", function () {
            call.active = true;
            statusEl.textContent = "Forbundet — I taler nu sammen";
            callBtn.textContent = "⏹";
          });
          twilioCall.on("disconnect", handleCallEnd);
          twilioCall.on("error", function () {
            statusEl.textContent = "Der opstod en fejl under samtalen.";
          });
        })
        .catch(function (err) {
          console.error("[aibooking] Twilio Relay widget failed to start:", err);
          statusEl.textContent =
            err.status === 402
              ? "Ikke flere minutter tilgængelige lige nu."
              : "Kunne ikke forbinde (" + (err && err.message ? err.message : "ukendt fejl") + "). Prøv igen.";
        });
    }

    callBtn.addEventListener("click", function () {
      if (call.active && call.activeCall) call.activeCall.disconnect();
      else startCall();
    });

    window.addEventListener("beforeunload", function () {
      if (call.active && call.activeCall) call.activeCall.disconnect();
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
      else if (data.config.mode === "vapi") buildVapiUI(data.config);
      else if (data.config.mode === "twilio_relay") buildTwilioRelayUI(data.config);
      else buildUI(data.config);
    })
    .catch(function (err) {
      console.error("[aibooking] failed to load widget config:", err);
    });
})();
