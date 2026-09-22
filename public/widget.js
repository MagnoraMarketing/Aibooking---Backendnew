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

  // Errors that reach a customer-visible status line arrive in whatever shape
  // their source felt like. An Error has a string `message`; a Vapi call
  // error can carry `error.message` that is the *parsed body* of a failed
  // HTTP request — an object, not a string. Concatenating one of those into
  // a status line produced the literal "Fejl: [object Object]": visible to
  // the customer, useless to everyone, and hiding the one piece of text that
  // says what actually went wrong.
  //
  // Walk the usual nesting for the first real string, and fall back to
  // compact JSON rather than to nothing, so even an unfamiliar shape says
  // something. Returns null only when there is genuinely nothing to show.
  function describeError(value, depth) {
    depth = depth || 0;
    if (value == null || depth > 4) return null;
    if (typeof value === "string") return value.trim() || null;
    if (typeof value !== "object") return String(value);

    var keys = ["message", "errorMsg", "msg", "error", "reason", "statusText", "description"];
    for (var i = 0; i < keys.length; i++) {
      var nested = describeError(value[keys[i]], depth + 1);
      if (nested) return nested;
    }

    try {
      var json = JSON.stringify(value);
      if (json && json !== "{}" && json !== "[]") {
        return json.length > 300 ? json.slice(0, 300) + "…" : json;
      }
    } catch (circular) {
      // A circular object can't be serialised — the console.error at the
      // call site still has the real thing.
    }
    return null;
  }

  // Ends a usage session — the only thing that bills its minutes against the
  // customer's credit ledger and closes the conversation (see
  // finalizeUsageSession in lib/usage/session.ts).
  //
  // While the page is alive that's a plain PATCH. When the visitor is
  // leaving (tab closed, navigation away) a normal fetch is cancelled
  // mid-flight, so we hand the request to navigator.sendBeacon instead,
  // which the browser delivers after the page is gone. sendBeacon can only
  // POST, and only skips the CORS preflight an unloading page would never
  // complete if the body carries a safelisted content type — hence the
  // dedicated /api/widget/session/end route and the text/plain blob (the
  // server parses the text as JSON regardless of the declared type).
  function endSession(sessionId, durationSeconds, unloading) {
    if (!sessionId) return;
    var payload = { sessionId: sessionId };
    // Only the engines that measure the call client-side (OpenAI Realtime,
    // Vapi) report a duration. The text pipeline accrues it server-side,
    // turn by turn, and sending a number here would overwrite that.
    if (typeof durationSeconds === "number") payload.clientMeasuredDurationSeconds = durationSeconds;
    var body = JSON.stringify(payload);

    if (unloading) {
      var url = apiBase + "/api/widget/session/end";
      if (navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }));
      } else {
        fetch(url, { method: "POST", body: body, keepalive: true }).catch(function () {});
      }
      return;
    }

    apiFetch("/api/widget/session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body,
    }).catch(function () {});
  }

  // Persists the visible transcript across page loads/reopenings, per widget
  // and per browser (localStorage, never sent to the server) — so a visitor
  // who closes the chat and comes back later still sees what they talked
  // about, even though every open still starts a fresh billed session (see
  // ensureSession/startCall below; there is no server-side conversation
  // resume). Wrapped in try/catch throughout: private browsing, a full quota
  // or a blocked storage API must never break the chat itself, only its
  // memory of past turns.
  var HISTORY_LIMIT = 40;

  function historyStorageKey() {
    return "aibooking_history_" + publicId;
  }

  function loadHistory() {
    try {
      var raw = window.localStorage.getItem(historyStorageKey());
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function appendToHistory(role, text) {
    try {
      var list = loadHistory();
      list.push({ role: role, text: text });
      window.localStorage.setItem(historyStorageKey(), JSON.stringify(list.slice(-HISTORY_LIMIT)));
    } catch (e) {
      // Storage unavailable/full — the current conversation carries on fine
      // without it, it just won't be there next time.
    }
  }

  // The launcher toggles the panel in every UI mode. Registering that in one
  // place also lets the host page open the agent itself — window.aibooking
  // .open() / .close() / .toggle() — so a site can wire its own "Book en
  // tid" button in the page body to the agent instead of relying on the
  // corner launcher alone. The dashboard's Test Agent preview opens the
  // widget through exactly this.
  function registerLauncher(launcher, panel, onOpen) {
    function setOpen(open) {
      state.open = open;
      panel.style.display = open ? "flex" : "none";
      if (open && onOpen) onOpen();
    }

    launcher.addEventListener("click", function () {
      setOpen(!state.open);
    });

    window.aibooking = {
      open: function () {
        setOpen(true);
      },
      close: function () {
        setOpen(false);
      },
      toggle: function () {
        setOpen(!state.open);
      },
    };
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


  // Renders an agent message into a bubble, turning product links into
  // something the customer can actually click.
  //
  // Two forms are recognised, and nothing else: a markdown link
  // "[Se produkt](https://…)", which the Shopify product tool asks the agent
  // to emit, and a bare https:// URL. Both become real <a> elements; every
  // other character stays a text node.
  //
  // Built with createElement and createTextNode, never innerHTML: the text
  // comes from a model that is in turn quoting a merchant's product data, so
  // it is never treated as markup. The scheme is checked too — an href is only
  // written when the URL parses as http(s), so a "javascript:" link in the
  // message can never become a clickable one in the widget.
  var MESSAGE_LINK_PATTERN = /\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')\]]+)/g;

  function isSafeHttpUrl(value) {
    try {
      var parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (err) {
      return false;
    }
  }

  function buildLink(href, label, primaryColor, asButton) {
    var anchor = document.createElement("a");
    anchor.setAttribute("href", href);
    anchor.setAttribute("target", "_blank");
    // noopener keeps the opened page from reaching back into the widget via
    // window.opener; noreferrer keeps the customer's page out of the referrer.
    anchor.setAttribute("rel", "noopener noreferrer");
    anchor.style.cssText = asButton
      ? "display:inline-block;margin-top:6px;padding:7px 14px;border-radius:999px;background:" +
        primaryColor +
        ";color:#fff;font-weight:600;font-size:13px;text-decoration:none;"
      : "color:inherit;text-decoration:underline;word-break:break-all;";
    anchor.appendChild(document.createTextNode(label));
    return anchor;
  }

  function appendMessageContent(node, text, primaryColor) {
    var value = typeof text === "string" ? text : String(text == null ? "" : text);
    var lastIndex = 0;
    var match;

    MESSAGE_LINK_PATTERN.lastIndex = 0;
    while ((match = MESSAGE_LINK_PATTERN.exec(value)) !== null) {
      if (match.index > lastIndex) {
        node.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
      }

      var label = match[1];
      var href = match[2] || match[3];

      if (href && isSafeHttpUrl(href)) {
        // A labelled link is the product CTA the agent was asked for, so it
        // gets the button treatment; a bare URL stays inline.
        node.appendChild(buildLink(href, label || href, primaryColor, Boolean(label)));
      } else {
        node.appendChild(document.createTextNode(match[0]));
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < value.length) {
      node.appendChild(document.createTextNode(value.slice(lastIndex)));
    }
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
          ";color:#fff;padding:16px 18px;font-weight:600;display:flex;align-items:center;gap:10px;",
      },
      [avatar, el("span", { style: "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;" }, [config.businessName || "AI-assistent"])]
    );
  }

  // The round launcher button — the uploaded avatar when there is one
  // (cropped into the circle), the given emoji glyph otherwise.
  function buildLauncher(config, pos, glyph) {
    var baseStyle =
      "position:fixed;" +
      pos +
      "width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;" +
      "box-shadow:0 10px 28px rgba(15,23,42,.28);z-index:999999;";

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
          "border:none;background:#f8fafc;color:#475569;border-radius:10px;padding:8px 10px;cursor:pointer;font-size:15px;",
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
      micBtn.style.background = "#f8fafc";
      micBtn.style.color = "#475569";
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
      style: "flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;font-size:14px;",
    });

    var sendBtn = el(
      "button",
      {
        style:
          "border:none;background:" + config.primaryColor + ";color:#fff;border-radius:10px;padding:8px 12px;cursor:pointer;",
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
          "width:360px;max-width:92vw;height:480px;max-height:72vh;margin-bottom:78px;" +
          "background:#fff;border-radius:22px;box-shadow:0 20px 50px rgba(15,23,42,.18);" +
          "border:1px solid rgba(15,23,42,.08);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        buildHeader(config),
        messagesEl,
        el(
          "div",
          { style: "display:flex;gap:8px;padding:10px;border-top:1px solid #e2e8f0;" },
          micBtn ? [micBtn, input, sendBtn] : [input, sendBtn]
        ),
        config.showBranding
          ? el(
              "div",
              { style: "text-align:center;font-size:11px;color:#94a3b8;padding:4px 0 8px;" },
              ["Powered by AIbooking.dk"]
            )
          : el("div", {}, []),
      ]
    );

    document.body.appendChild(panel);
    document.body.appendChild(launcher);

    function addMessage(text, role, skipPersist) {
      var bubble = el(
        "div",
        {
          style:
            "max-width:80%;padding:8px 12px;border-radius:16px;font-size:14px;line-height:1.4;" +
            (role === "user"
              ? "align-self:flex-end;background:" + config.primaryColor + ";color:#fff;"
              : "align-self:flex-start;background:#f8fafc;color:#1e293b;border:1px solid #e2e8f0;"),
        },
        []
      );
      appendMessageContent(bubble, text, config.primaryColor);
      messagesEl.appendChild(bubble);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      if (!skipPersist) appendToHistory(role, text);
    }

    // Replays whatever this visitor's browser has stored from earlier visits
    // (see appendToHistory above), then marks where today's conversation
    // starts — a fresh session/conversation is still created server-side on
    // the next message either way, this is purely what the panel shows.
    function restoreHistory() {
      var history = loadHistory();
      if (!history.length) return false;
      history.forEach(function (entry) {
        addMessage(entry.text, entry.role, true);
      });
      messagesEl.appendChild(
        el("div", { style: "text-align:center;font-size:11px;color:#94a3b8;margin:4px 0;" }, ["— Ny samtale —"])
      );
      return true;
    }

    var hadHistory = restoreHistory();

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
        // Skip the greeting for a visitor who already has a visible history —
        // they don't need re-welcoming every time they reopen the chat.
        if (data.openingMessage && !hadHistory) addMessage(data.openingMessage, "assistant");
      });
    }

    // pagehide rather than beforeunload: it also fires on mobile Safari and
    // when the page goes into the back/forward cache, where beforeunload
    // never runs at all.
    window.addEventListener("pagehide", function () {
      if (!state.sessionId) return;
      var sessionId = state.sessionId;
      state.sessionId = null;
      endSession(sessionId, undefined, true);
    });

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
          // Transient client-side notice, not part of the actual
          // conversation — shown once, never saved to history.
          addMessage(message, "assistant", true);
        });
    }

    sendBtn.addEventListener("click", send);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send();
    });

    registerLauncher(launcher, panel, ensureSession);
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
      { style: "font-size:13px;color:#475569;text-align:center;padding:4px 0 10px;" },
      ["Klik på mikrofonen for at starte samtalen"]
    );

    var callBtn = el(
      "button",
      {
        style:
          "width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;display:block;margin:0 auto;box-shadow:0 8px 22px rgba(15,23,42,.2);" +
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
          "width:360px;max-width:92vw;height:480px;max-height:72vh;margin-bottom:78px;" +
          "background:#fff;border-radius:22px;box-shadow:0 20px 50px rgba(15,23,42,.18);" +
          "border:1px solid rgba(15,23,42,.08);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        buildHeader(config),
        transcriptEl,
        el("div", { style: "padding:12px;border-top:1px solid #e2e8f0;" }, [callBtn, statusEl]),
        config.showBranding
          ? el(
              "div",
              { style: "text-align:center;font-size:11px;color:#94a3b8;padding:0 0 8px;" },
              ["Powered by AIbooking.dk"]
            )
          : el("div", {}, []),
      ]
    );

    document.body.appendChild(panel);
    document.body.appendChild(launcher);

    function addTranscriptLine(text, role, skipPersist) {
      var bubble = el(
        "div",
        {
          style:
            "max-width:80%;padding:8px 12px;border-radius:16px;font-size:14px;line-height:1.4;" +
            (role === "user"
              ? "align-self:flex-end;background:" + config.primaryColor + ";color:#fff;"
              : "align-self:flex-start;background:#f8fafc;color:#1e293b;border:1px solid #e2e8f0;"),
        },
        []
      );
      appendMessageContent(bubble, text, config.primaryColor);
      transcriptEl.appendChild(bubble);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
      if (!skipPersist) appendToHistory(role, text);
    }

    // Replays this visitor's stored transcript from earlier visits (see
    // appendToHistory above) before today's live transcript starts.
    (function restoreHistory() {
      var history = loadHistory();
      if (!history.length) return;
      history.forEach(function (entry) {
        addTranscriptLine(entry.text, entry.role, true);
      });
      transcriptEl.appendChild(
        el("div", { style: "text-align:center;font-size:11px;color:#94a3b8;margin:4px 0;" }, ["— Ny samtale —"])
      );
    })();

    // `starting` covers the gap between the button being pressed and the
    // call being up — see the note on the Vapi UI's own flag below.
    var rtc = { pc: null, dc: null, micStream: null, audioEl: null, startedAt: null, active: false, starting: false };

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

    function endCall(unloading) {
      rtc.starting = false;
      if (!rtc.active) return;
      rtc.active = false;
      var durationSeconds = rtc.startedAt ? (Date.now() - rtc.startedAt) / 1000 : 0;
      teardownConnection();
      statusEl.textContent = "Samtalen er afsluttet";
      callBtn.textContent = "🎙";

      if (state.sessionId) {
        var sessionId = state.sessionId;
        state.sessionId = null;
        endSession(sessionId, durationSeconds, unloading);
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
          rtc.starting = false;
          rtc.active = true;
          rtc.startedAt = Date.now();
          statusEl.textContent = "Forbundet — I taler nu sammen";
          callBtn.textContent = "⏹";
        });
    }

    function startCall() {
      if (rtc.starting || rtc.active) return;
      rtc.starting = true;
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
          rtc.starting = false;
          teardownConnection();
          statusEl.textContent =
            err.status === 402
              ? "Ikke flere minutter tilgængelige lige nu."
              : "Kunne ikke forbinde (" + (describeError(err) || "ukendt fejl") + "). Prøv igen.";
        });
    }

    callBtn.addEventListener("click", function () {
      if (rtc.active) endCall();
      else startCall();
    });

    window.addEventListener("pagehide", function () {
      if (rtc.active) endCall(true);
    });

    registerLauncher(launcher, panel);
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
      { style: "font-size:13px;color:#475569;text-align:center;padding:4px 0 10px;" },
      ["Klik på mikrofonen for at starte samtalen"]
    );

    var callBtn = el(
      "button",
      {
        style:
          "width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;display:block;margin:0 auto;box-shadow:0 8px 22px rgba(15,23,42,.2);" +
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
          "width:360px;max-width:92vw;height:480px;max-height:72vh;margin-bottom:78px;" +
          "background:#fff;border-radius:22px;box-shadow:0 20px 50px rgba(15,23,42,.18);" +
          "border:1px solid rgba(15,23,42,.08);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        buildHeader(config),
        transcriptEl,
        el("div", { style: "padding:12px;border-top:1px solid #e2e8f0;" }, [callBtn, statusEl]),
        config.showBranding
          ? el(
              "div",
              { style: "text-align:center;font-size:11px;color:#94a3b8;padding:0 0 8px;" },
              ["Powered by AIbooking.dk"]
            )
          : el("div", {}, []),
      ]
    );

    document.body.appendChild(panel);
    document.body.appendChild(launcher);

    function addTranscriptLine(text, role, skipPersist) {
      var bubble = el(
        "div",
        {
          style:
            "max-width:80%;padding:8px 12px;border-radius:16px;font-size:14px;line-height:1.4;" +
            (role === "user"
              ? "align-self:flex-end;background:" + config.primaryColor + ";color:#fff;"
              : "align-self:flex-start;background:#f8fafc;color:#1e293b;border:1px solid #e2e8f0;"),
        },
        []
      );
      appendMessageContent(bubble, text, config.primaryColor);
      transcriptEl.appendChild(bubble);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
      if (!skipPersist) appendToHistory(role, text);
    }

    // Replays this visitor's stored transcript from earlier visits (see
    // appendToHistory above) before today's live transcript starts.
    (function restoreHistory() {
      var history = loadHistory();
      if (!history.length) return;
      history.forEach(function (entry) {
        addTranscriptLine(entry.text, entry.role, true);
      });
      transcriptEl.appendChild(
        el("div", { style: "text-align:center;font-size:11px;color:#94a3b8;margin:4px 0;" }, ["— Ny samtale —"])
      );
    })();

    // `starting` covers the gap between the button being pressed and Vapi
    // reporting the call up. It used to be unguarded: a second tap during
    // "Forbinder..." — a double tap on a phone is enough — opened a second
    // session and a second conversation row, and the call then matched two
    // conversations instead of one, so the webhook refused to attach the
    // transcript and recording to either (see linkConversationToCall).
    var call = { client: null, active: false, starting: false, startedAt: null };

    // All end-of-call bookkeeping (duration, billing PATCH, UI reset) lives
    // here and only here — the call button just tells the SDK to stop,
    // whether the user hangs up or the assistant/Vapi ends the call first,
    // both paths converge on the SDK's own "call-end" event.
    function handleCallEnd(unloading) {
      call.starting = false;
      if (!call.active) return;
      call.active = false;
      var durationSeconds = call.startedAt ? (Date.now() - call.startedAt) / 1000 : 0;
      statusEl.textContent = "Samtalen er afsluttet";
      callBtn.textContent = "🎙";

      if (state.sessionId) {
        var sessionId = state.sessionId;
        state.sessionId = null;
        endSession(sessionId, durationSeconds, unloading);
      }
    }

    function handleMessage(message) {
      if (message && message.type === "transcript" && message.transcriptType === "final" && message.transcript) {
        addTranscriptLine(message.transcript, message.role === "user" ? "user" : "assistant");
      }
    }

    function startCall() {
      if (call.starting || call.active) return;
      call.starting = true;
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
                call.starting = false;
                call.active = true;
                call.startedAt = Date.now();
                statusEl.textContent = "Forbundet — I taler nu sammen";
                callBtn.textContent = "⏹";
              });
              // Wrapped, not passed directly: the SDK hands its listeners an
              // event object, which would land in handleCallEnd's
              // `unloading` parameter and send the billing call as an
              // unload beacon while the page is very much still alive.
              call.client.on("call-end", function () {
                handleCallEnd();
              });
              call.client.on("message", handleMessage);
              call.client.on("error", function (e) {
                // Vapi's error event shape isn't fixed (varies by failure
                // source — mic permissions, ICE negotiation, the assistant
                // itself) — surface whatever text it gives us instead of a
                // dead-end generic message, and always log the raw object so
                // it's visible in devtools even when no readable text exists.
                console.error("Vapi call error:", e);
                call.starting = false;
                var detail = describeError(e);
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
          call.starting = false;
          statusEl.textContent =
            err.status === 402
              ? "Ikke flere minutter tilgængelige lige nu."
              : "Kunne ikke forbinde (" + (describeError(err) || "ukendt fejl") + "). Prøv igen.";
        });
    }

    callBtn.addEventListener("click", function () {
      if (call.active) call.client.stop();
      else startCall();
    });

    // Bill the call ourselves before asking the SDK to stop: the SDK's own
    // "call-end" event is what normally triggers handleCallEnd, and it has
    // no chance to fire once the page is unloading. Flipping call.active
    // here also makes that late event a no-op if it does arrive.
    window.addEventListener("pagehide", function () {
      if (!call.active) return;
      handleCallEnd(true);
      if (call.client) {
        try {
          call.client.stop();
        } catch (e) {}
      }
    });

    registerLauncher(launcher, panel);
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
      { style: "flex:1;display:flex;align-items:center;justify-content:center;font-size:14px;color:#475569;text-align:center;padding:12px;" },
      ["Klik på mikrofonen for at starte samtalen"]
    );

    var callBtn = el(
      "button",
      {
        style:
          "width:64px;height:64px;border-radius:50%;border:none;cursor:pointer;display:block;margin:0 auto;box-shadow:0 8px 22px rgba(15,23,42,.2);" +
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
          "width:360px;max-width:92vw;height:480px;max-height:72vh;margin-bottom:78px;" +
          "background:#fff;border-radius:22px;box-shadow:0 20px 50px rgba(15,23,42,.18);" +
          "border:1px solid rgba(15,23,42,.08);" +
          "display:none;flex-direction:column;overflow:hidden;z-index:999999;font-family:system-ui,sans-serif;",
      },
      [
        buildHeader(config),
        statusEl,
        el("div", { style: "padding:12px;border-top:1px solid #e2e8f0;" }, [callBtn]),
        config.showBranding
          ? el(
              "div",
              { style: "text-align:center;font-size:11px;color:#94a3b8;padding:0 0 8px;" },
              ["Powered by AIbooking.dk"]
            )
          : el("div", {}, []),
      ]
    );

    document.body.appendChild(panel);
    document.body.appendChild(launcher);

    var call = { device: null, activeCall: null, active: false, starting: false };

    // Billing is handled entirely server-side (relay-server measures the
    // real ConversationRelay connection duration and reports it to
    // /api/internal/conversation-relay/end when the call ends) — unlike the
    // realtime/Vapi UIs above, this handler never PATCHes /api/widget/session.
    function handleCallEnd() {
      call.starting = false;
      if (!call.active) return;
      call.active = false;
      call.activeCall = null;
      statusEl.textContent = "Samtalen er afsluttet";
      callBtn.textContent = "🎙";
    }

    function startCall() {
      if (call.starting || call.active) return;
      call.starting = true;
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
              call.device.on("error", function (e) {
                console.error("Twilio device error:", e);
                var detail = describeError(e);
                statusEl.textContent = detail
                  ? "Fejl: " + detail
                  : "Der opstod en fejl under samtalen (se browserkonsollen for detaljer).";
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
            call.starting = false;
            call.active = true;
            statusEl.textContent = "Forbundet — I taler nu sammen";
            callBtn.textContent = "⏹";
          });
          twilioCall.on("disconnect", handleCallEnd);
          twilioCall.on("error", function (e) {
            console.error("Twilio call error:", e);
            call.starting = false;
            var detail = describeError(e);
            statusEl.textContent = detail
              ? "Fejl: " + detail
              : "Der opstod en fejl under samtalen (se browserkonsollen for detaljer).";
          });
        })
        .catch(function (err) {
          console.error("[aibooking] Twilio Relay widget failed to start:", err);
          call.starting = false;
          statusEl.textContent =
            err.status === 402
              ? "Ikke flere minutter tilgængelige lige nu."
              : "Kunne ikke forbinde (" + (describeError(err) || "ukendt fejl") + "). Prøv igen.";
        });
    }

    callBtn.addEventListener("click", function () {
      if (call.active && call.activeCall) call.activeCall.disconnect();
      else startCall();
    });

    window.addEventListener("beforeunload", function () {
      if (call.active && call.activeCall) call.activeCall.disconnect();
    });

    registerLauncher(launcher, panel);
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
