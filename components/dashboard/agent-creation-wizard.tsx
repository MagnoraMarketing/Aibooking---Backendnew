"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LLMModel, Package, VoiceModel } from "@/types/database";
import type { SavePatch, WidgetWithExtras } from "./agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";
import { agentSectionPath } from "./agent-sections";
import { KnowledgeBaseTab } from "./agent-tabs/knowledge-base-tab";
import { PromptLabTab } from "./agent-tabs/prompt-lab";
import { WizardVoiceStep } from "./agent-tabs/wizard-voice-step";
import { WizardCalendarStep } from "./agent-tabs/wizard-calendar-step";
import { TestAgentTab } from "./agent-tabs/test-agent";
import { WizardPaymentStep } from "./agent-tabs/wizard-payment-step";
import { WizardPhoneStep } from "./agent-tabs/wizard-phone-step";
import { TestCallTab } from "./agent-tabs/test-call";
import { FlowProgress, StepFooter, StepHeader } from "./agent-flow-ui";

type AgentType = "widget" | "phone";

// What the agent is *for* — separate from AgentType (widget vs phone, i.e.
// the delivery channel). Picked up front, before there's a calendar or
// webshop to connect, purely to steer how "Generér prompt" (step 3) writes
// the agent's instructions — see taskBullets in
// app/api/customer/widgets/[id]/generate-prompt/route.ts. The booking/
// Shopify *tools* themselves stay gated by an actually-connected calendar/
// webshop regardless of this choice (see syncWidgetToVapiAssistant).
type AgentPurpose = "booking" | "shopify" | "qa";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

function typeOptionsFor(t: Translate): {
  value: AgentType;
  title: string;
  description: string;
}[] {
  return [
    {
      value: "widget",
      title: t("agent.wizard.type.widgetTitle"),
      description: t("agent.wizard.type.widgetDescription"),
    },
    {
      value: "phone",
      title: t("agent.wizard.type.phoneTitle"),
      description: t("agent.wizard.type.phoneDescription"),
    },
  ];
}

function purposeOptionsFor(t: Translate): { value: AgentPurpose; title: string; description: string }[] {
  return [
    {
      value: "booking",
      title: t("agent.wizard.purpose.bookingTitle"),
      description: t("agent.wizard.purpose.bookingDescription"),
    },
    {
      value: "shopify",
      title: t("agent.wizard.purpose.shopifyTitle"),
      description: t("agent.wizard.purpose.shopifyDescription"),
    },
    {
      value: "qa",
      title: t("agent.wizard.purpose.qaTitle"),
      description: t("agent.wizard.purpose.qaDescription"),
    },
  ];
}

// Which engine powers a Voice Widget's realtime call is ours to decide, not
// the customer's: AI Booking is the product, and the engine behind it is an
// implementation detail they shouldn't have to hold an opinion about (nor be
// stranded by if we ever swap it). Widgets are created on this provider and
// the picker that used to sit in step 1 is gone. The Twilio ConversationRelay
// path (0024_twilio_conversation_relay.sql) still exists server-side for
// phone agents — it just isn't a choice presented here, and its TTS/voice
// side is still incomplete.
const WIDGET_LLM_PROVIDER = "vapi";

type StepKey = "basics" | "knowledge" | "prompt" | "voice" | "calendar" | "phone" | "test";

interface WizardStep {
  key: StepKey;
  label: string;
}

// One continuous flow: name -> knowledge -> prompt -> voice -> calendar ->
// (phone number, for a phone agent) -> test. Testing is always the last
// step, so whatever was set up along the way is what gets tried — and for a
// Voice Widget the same screen then shows how to put it live (embed code, or
// the launch offer when that still has to be paid for). Nobody is asked to
// pay before they have heard the agent talk.
//
// Knowledge comes before the prompt: the generated prompt is written with
// the attached sources in view (see
// app/api/customer/widgets/[id]/generate-prompt), so a customer who pastes
// their website first gets a draft about their actual business.
//
// A phone agent is tested as a call (TestCallTab), not as a bubble on a
// stand-in website, and gets its number before that, since the number is
// what the test call goes to.
function stepsFor(agentType: AgentType | null, t: Translate): WizardStep[] {
  const steps: WizardStep[] = [
    { key: "basics", label: t("agent.wizard.step.nameType") },
    { key: "knowledge", label: t("agent.wizard.step.knowledge") },
    { key: "prompt", label: t("agent.wizard.step.prompt") },
    { key: "voice", label: t("agent.wizard.step.voice") },
    { key: "calendar", label: t("agent.wizard.step.calendar") },
  ];
  if (agentType === "phone") steps.push({ key: "phone", label: t("agent.wizard.step.phone") });
  steps.push({ key: "test", label: t("agentFlow.wizard.stepTest") });
  return steps;
}

interface AgentCreationWizardProps {
  llmModels: LLMModel[];
  voiceModels: VoiceModel[];
  embedCodeUnlocked: boolean;
  trialDaysRemaining: number;
  pkg: Package | null;
  onCancel: () => void;
  onComplete: (widget: WidgetWithExtras) => void;
  // Set when the wizard is launched from a type-specific entry point (the
  // Widget Agents page, or the Inbound/Outbound page's phone-agent panel) —
  // skips the type picker in step 0 and shows a fixed label instead, since
  // the context already answered that question.
  fixedType?: AgentType;
  // An agent that already exists but was never set up (the one made at
  // signup — see needsSetup in lib/security/schemas.ts). The flow opens on it
  // instead of creating another: step 1 renames it, and the last step marks
  // it as set up.
  resumeWidget?: WidgetWithExtras;
}

// The first-run "very simple steps" flow: create the agent, then walk it
// through prompt -> voice -> calendar -> test -> payment one screen at a
// time, reusing the same tab components (PromptLabTab, TestAgentTab) the
// full agent config page uses later — a widget saved mid-wizard is exactly
// as valid/complete as one saved from the tabs, so abandoning partway never
// leaves anything broken, just unfinished. Leaving to pay is the one exit
// that comes back: Stripe returns the customer to their agent with the
// minutes already credited (app/dashboard/checkout/return/page.tsx).
export function AgentCreationWizard({
  llmModels,
  voiceModels,
  embedCodeUnlocked,
  trialDaysRemaining,
  pkg,
  onCancel,
  onComplete,
  fixedType,
  resumeWidget,
}: AgentCreationWizardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [widget, setWidget] = useState<WidgetWithExtras | null>(resumeWidget ?? null);

  const [name, setName] = useState(resumeWidget?.name ?? "");
  const [agentType, setAgentType] = useState<AgentType | null>(
    fixedType ?? (resumeWidget ? (resumeWidget.agent_type === "phone" ? "phone" : "widget") : null)
  );
  const [agentPurposes, setAgentPurposes] = useState<AgentPurpose[]>(resumeWidget?.extra.agentPurposes ?? []);
  const [purposeNotes, setPurposeNotes] = useState(resumeWidget?.extra.purposeNotes ?? "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = stepsFor(agentType, t);
  const typeOptions = typeOptionsFor(t);
  const purposeOptions = purposeOptionsFor(t);

  function togglePurpose(value: AgentPurpose) {
    setAgentPurposes((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
  }
  // Steps are addressed by name, not index — the widget flow has two more
  // than the phone one, so an index alone says nothing about what to render.
  const currentKey = steps[step]?.key;
  // Every step change starts at the top of the new step — on a phone the
  // buttons that moved on sit far below the next step's heading.
  const goTo = (index: number) => {
    setStep(Math.max(0, Math.min(index, steps.length - 1)));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goNext = () => goTo(step + 1);
  const goBack = () => goTo(step - 1);

  const savePatch: SavePatch = async (patch) => {
    if (!widget) return false;
    const res = await fetch(`/api/customer/widgets/${widget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return false;
    const { widget: updated } = await res.json();
    setWidget((prev) => (prev ? { ...prev, ...updated } : prev));
    return true;
  };

  async function handleCreate() {
    if (!name.trim()) {
      setError(t("agent.wizard.errorNameRequired"));
      return;
    }
    if (!agentType) {
      setError(t("agent.wizard.errorTypeRequired"));
      return;
    }
    // Both types run on Vapi now: a phone agent used to be created on the
    // Anthropic model and answer calls through our own TwiML pipeline, but an
    // inbound number always goes to a Vapi assistant (see
    // lib/phone-numbers/service.ts). What the agent IS travels as agentType
    // instead — the model no longer says anything about it.
    const selectedModelId = llmModels.find((m) => m.provider === WIDGET_LLM_PROVIDER)?.id ?? null;
    if (!selectedModelId) {
      setError(t("agent.wizard.errorNoModel"));
      return;
    }

    setCreating(true);
    setError(null);

    const res = await fetch("/api/customer/widgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), llmModelId: selectedModelId, agentType }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("agent.wizard.errorCreateFailed"));
      return;
    }

    const { widget: created } = await res.json();
    let extra: WidgetWithExtras["extra"] = {};

    // Persisted right after creation, same as every other wizard step's
    // answers — read back by generate-prompt (see taskBullets there) once
    // the customer reaches step 3. Skipped entirely when nothing was
    // picked, so a customer who ignores this new step leaves no trace of
    // it and generate-prompt falls back to its original, purpose-agnostic
    // wording.
    if (agentPurposes.length > 0 || purposeNotes.trim()) {
      const patchRes = await fetch(`/api/customer/widgets/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extra: { agentPurposes, purposeNotes: purposeNotes.trim() || null },
        }),
      });
      if (patchRes.ok) {
        const { widget: patched } = await patchRes.json();
        extra = patched.extra ?? extra;
      }
    }

    setWidget({ ...created, extra });
    goTo(1);
  }

  // complete: the customer went all the way to the last step. Leaving early
  // ("Gem og luk") keeps an unfinished agent marked as such, so the list keeps
  // offering to continue its setup.
  async function handleFinish(complete = false) {
    if (!widget) return;
    if (complete && widget.extra.needsSetup) {
      await savePatch({ extra: { needsSetup: false } });
    }
    onComplete(widget);
    // Into the new agent's own section, not always Widget Agents.
    router.push(`${agentSectionPath(agentType ?? "widget")}/${widget.id}`);
  }


  // Back to step 1 after the agent exists only renames it — creating it a
  // second time would leave a stray copy in the list.
  async function handleBasicsNext() {
    if (!widget) {
      await handleCreate();
      return;
    }
    if (!name.trim()) {
      setError(t("agent.wizard.errorNameRequired"));
      return;
    }
    setCreating(true);
    setError(null);
    const ok = await savePatch({
      name: name.trim(),
      extra: { agentPurposes, purposeNotes: purposeNotes.trim() || null },
    });
    setCreating(false);
    if (!ok) {
      setError(`${t("common.saveFailed")} ${t("common.tryAgain")}`);
      return;
    }
    goNext();
  }

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
            {resumeWidget
              ? t("agentFlow.wizard.continueSetup")
              : agentType === "phone"
                ? t("agentFlow.wizard.newPhoneAgent")
                : t("agentFlow.wizard.newWidgetAgent")}
          </p>
          <p className="truncate text-base font-semibold text-slate-900">
            {widget?.name ?? (name.trim() || t("agentFlow.wizard.untitled"))}
          </p>
        </div>
        <button
          type="button"
          onClick={widget ? () => handleFinish(false) : onCancel}
          className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          {widget ? t("agentFlow.wizard.saveAndClose") : t("common.cancel")}
        </button>
      </div>

      <FlowProgress steps={steps} current={step} onSelect={widget ? goTo : undefined} />

      {currentKey === "basics" ? (
        <div className="space-y-5">
          <StepHeader title={t("agentFlow.wizard.basicsTitle")} description={t("agentFlow.wizard.basicsDescription")} />
          <div>
            <label htmlFor="agent-name" className="mb-1 block text-sm font-medium text-slate-700">
              {t("agent.wizard.agentNameLabel")}
            </label>
            <input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("agent.wizard.agentNamePlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3 py-3 text-base outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 sm:py-2 sm:text-sm"
            />
          </div>

          {fixedType ? null : (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">{t("agent.wizard.typeQuestion")}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {typeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={Boolean(widget)}
                    onClick={() => setAgentType(option.value)}
                    className={`rounded-xl border p-4 text-left transition disabled:opacity-60 ${
                      agentType === option.value
                        ? "border-brand-500 ring-1 ring-brand-500"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-800">{option.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{option.description}</p>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">{t("agent.wizard.typeHelp")}</p>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">{t("agent.wizard.purposeQuestion")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
              {purposeOptions.map((option) => {
                const selected = agentPurposes.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => togglePurpose(option.value)}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition sm:block sm:p-4 ${
                      selected ? "border-brand-500 bg-brand-50/40 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs sm:hidden ${
                        selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300"
                      }`}
                    >
                      {selected ? "✓" : ""}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">{option.title}</span>
                      <span className="mt-1 block text-xs text-slate-500">{option.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-slate-500">{t("agent.wizard.purposeHelp")}</p>

            {agentPurposes.includes("qa") ? (
              <div className="mt-3">
                <label htmlFor="agent-purpose-notes" className="mb-1 block text-sm font-medium text-slate-700">
                  {t("agent.wizard.purposeNotesLabel")}
                </label>
                <textarea
                  id="agent-purpose-notes"
                  value={purposeNotes}
                  onChange={(e) => setPurposeNotes(e.target.value)}
                  placeholder={t("agent.wizard.purposeNotesPlaceholder")}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-base outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 sm:text-sm"
                />
              </div>
            ) : null}
          </div>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <StepFooter
            onBack={widget ? undefined : onCancel}
            backLabel={t("common.cancel")}
            primary={{
              label: creating ? t("agent.wizard.creating") : t("agent.wizard.nextArrow"),
              onClick: handleBasicsNext,
              disabled: creating || !agentType,
            }}
          />
        </div>
      ) : null}

      {currentKey === "knowledge" && widget ? (
        <div className="space-y-5">
          <StepHeader title={t("agent.wizard.knowledgeTitle")} description={t("agent.wizard.knowledgeDescription")} />
          <KnowledgeBaseTab
            widget={widget}
            onSourcesChange={(knowledgeBase) =>
              setWidget((prev) => (prev ? { ...prev, extra: { ...prev.extra, knowledgeBase } } : prev))
            }
          />
          <StepFooter
            onBack={goBack}
            onSkip={(widget.extra.knowledgeBase?.length ?? 0) > 0 ? undefined : goNext}
            primary={{ label: t("agent.wizard.nextArrow"), onClick: goNext }}
          />
        </div>
      ) : null}

      {currentKey === "prompt" && widget ? (
        <div className="space-y-5">
          <StepHeader
            title={t("agent.wizard.promptTitle")}
            description={
              (widget.extra.knowledgeBase?.length ?? 0) > 0
                ? t("agent.wizard.promptDescriptionWithKnowledge", { count: widget.extra.knowledgeBase!.length })
                : t("agent.wizard.promptDescription")
            }
          />
          <PromptLabTab widget={widget} savePatch={savePatch} />
          <StepFooter onBack={goBack} primary={{ label: t("agent.wizard.nextArrow"), onClick: goNext }} />
        </div>
      ) : null}

      {currentKey === "voice" && widget ? (
        <WizardVoiceStep
          widget={widget}
          llmModels={llmModels}
          voiceModels={voiceModels}
          savePatch={savePatch}
          onNext={goNext}
          onBack={goBack}
        />
      ) : null}

      {currentKey === "calendar" && widget ? (
        <WizardCalendarStep widget={widget} onNext={goNext} onBack={goBack} />
      ) : null}

      {currentKey === "phone" && widget ? (
        <div className="space-y-5">
          <WizardPhoneStep widget={widget} />
          <StepFooter onBack={goBack} primary={{ label: t("agent.wizard.nextArrow"), onClick: goNext }} />
        </div>
      ) : null}

      {/* The last step, always: try the agent as it was just set up. A Voice
          Widget is tried on a stand-in website (the same preview the agent
          page's Test tab shows), a phone agent with a real call. */}
      {currentKey === "test" && widget ? (
        <div className="space-y-6">
          <StepHeader
            title={agentType === "phone" ? t("agentFlow.wizard.testPhoneTitle") : t("agentFlow.wizard.testWidgetTitle")}
            description={
              agentType === "phone" ? t("agentFlow.wizard.testPhoneDescription") : t("agent.wizard.testDescription")
            }
          />
          {agentType === "phone" ? (
            <TestCallTab widget={widget} />
          ) : (
            <TestAgentTab
              widget={widget}
              onWidgetChange={(updated) => setWidget((prev) => (prev ? { ...prev, ...updated } : prev))}
            />
          )}

          {agentType !== "phone" ? (
            <div className="space-y-3 border-t border-slate-100 pt-6">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t("agentFlow.wizard.goLiveLabel")}
              </p>
              <WizardPaymentStep
                widget={widget}
                unlocked={embedCodeUnlocked}
                trialDaysRemaining={trialDaysRemaining}
                pkg={pkg}
              />
            </div>
          ) : null}

          {/* With the launch offer still to pay, paying is the main action on
              this screen and finishing is the quiet way out. */}
          <StepFooter
            onBack={goBack}
            primary={{
              label: t("agent.wizard.finish"),
              onClick: () => handleFinish(true),
              subtle: agentType !== "phone" && !embedCodeUnlocked,
            }}
          />
        </div>
      ) : null}

    </div>
  );
}
