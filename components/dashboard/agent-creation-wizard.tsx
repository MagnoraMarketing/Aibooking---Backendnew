"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LLMModel, Package, VoiceModel } from "@/types/database";
import type { SavePatch, WidgetWithExtras } from "./agent-configurator";
import { useTranslation } from "@/components/i18n/language-provider";
import { KnowledgeBaseTab } from "./agent-tabs/knowledge-base-tab";
import { PromptLabTab } from "./agent-tabs/prompt-lab";
import { WizardVoiceStep } from "./agent-tabs/wizard-voice-step";
import { WizardCalendarStep } from "./agent-tabs/wizard-calendar-step";
import { WizardWebshopStep } from "./agent-tabs/wizard-webshop-step";
import { TestAgentTab } from "./agent-tabs/test-agent";
import { WizardPaymentStep } from "./agent-tabs/wizard-payment-step";
import { WizardPhoneStep } from "./agent-tabs/wizard-phone-step";

type AgentType = "widget" | "phone";

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

// Which engine powers a Voice Widget's realtime call is ours to decide, not
// the customer's: AI Booking is the product, and the engine behind it is an
// implementation detail they shouldn't have to hold an opinion about (nor be
// stranded by if we ever swap it). Widgets are created on this provider and
// the picker that used to sit in step 1 is gone. The Twilio ConversationRelay
// path (0024_twilio_conversation_relay.sql) still exists server-side for
// phone agents — it just isn't a choice presented here, and its TTS/voice
// side is still incomplete.
const WIDGET_LLM_PROVIDER = "vapi";

type StepKey = "basics" | "knowledge" | "prompt" | "voice" | "calendar" | "webshop" | "test" | "payment" | "phone";

interface WizardStep {
  key: StepKey;
  label: string;
}

// One continuous flow instead of a set of tabs: name -> knowledge -> prompt
// -> voice -> calendar, then try the agent for real, then pay to put it
// live. Trying it *before* the payment step is the point of that order —
// nobody should be asked to pay for something they haven't heard talk.
//
// Knowledge comes before the prompt for the same kind of reason: the
// generated prompt is written with the attached sources in view (see
// app/api/customer/widgets/[id]/generate-prompt), so a customer who pastes
// their website first gets a draft about their actual business rather than
// one about whatever fits in four form fields.
//
// Phone agents keep their own tail (a number to call, not an embed to pay
// for): the Test step previews a website embed, which a phone agent has no
// use for, and the number itself is ordered from the Inbound page.
//
// A customer who already has access (an active subscription, or a launch
// offer paid for an earlier widget) gets the same step labelled as what it
// actually shows them — the embed code, with nothing to pay.
function stepsFor(agentType: AgentType | null, embedCodeUnlocked: boolean, t: Translate): WizardStep[] {
  const steps: WizardStep[] = [
    { key: "basics", label: t("agent.wizard.step.nameType") },
    { key: "knowledge", label: t("agent.wizard.step.knowledge") },
    { key: "prompt", label: t("agent.wizard.step.prompt") },
    { key: "voice", label: t("agent.wizard.step.voice") },
    { key: "calendar", label: t("agent.wizard.step.calendar") },
    { key: "webshop", label: t("agent.wizard.step.webshop") },
  ];
  if (agentType === "phone") {
    steps.push({ key: "phone", label: t("agent.wizard.step.phone") });
    return steps;
  }
  steps.push({ key: "test", label: t("agent.wizard.step.test") });
  steps.push({
    key: "payment",
    label: embedCodeUnlocked ? t("agent.wizard.step.embedCode") : t("agent.wizard.step.payment"),
  });
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
}

function StepProgress({ step, steps }: { step: number; steps: WizardStep[] }) {
  return (
    <div className="flex items-center gap-2">
      {steps.map(({ key, label }, i) => (
        <div key={key} className="flex flex-1 items-center gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                i < step
                  ? "bg-emerald-500 text-white"
                  : i === step
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={`hidden text-xs font-medium sm:inline ${i === step ? "text-slate-900" : "text-slate-400"}`}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 ? <div className={`h-px flex-1 ${i < step ? "bg-emerald-500" : "bg-slate-200"}`} /> : null}
        </div>
      ))}
    </div>
  );
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
}: AgentCreationWizardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [widget, setWidget] = useState<WidgetWithExtras | null>(null);

  const [name, setName] = useState("");
  const [agentType, setAgentType] = useState<AgentType | null>(fixedType ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps = stepsFor(agentType, embedCodeUnlocked, t);
  const typeOptions = typeOptionsFor(t);
  // Steps are addressed by name, not index — the widget flow has two more
  // than the phone one, so an index alone says nothing about what to render.
  const currentKey = steps[step]?.key;
  const goNext = () => setStep((prev) => Math.min(prev + 1, steps.length - 1));

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
    const provider = agentType === "phone" ? "anthropic" : WIDGET_LLM_PROVIDER;
    const selectedModelId = llmModels.find((m) => m.provider === provider)?.id ?? null;
    if (!selectedModelId) {
      setError(t("agent.wizard.errorNoModel"));
      return;
    }

    setCreating(true);
    setError(null);

    const res = await fetch("/api/customer/widgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), llmModelId: selectedModelId }),
    });

    setCreating(false);

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? t("agent.wizard.errorCreateFailed"));
      return;
    }

    const { widget: created } = await res.json();
    setWidget({ ...created, extra: {} });
    setStep(1);
  }

  function handleFinish() {
    if (!widget) return;
    onComplete(widget);
    router.push(`/dashboard/agent/${widget.id}`);
  }

  return (
    <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <StepProgress step={step} steps={steps} />

      {currentKey === "basics" ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="agent-name" className="mb-1 block text-sm font-medium text-slate-700">
              {t("agent.wizard.agentNameLabel")}
            </label>
            <input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("agent.wizard.agentNamePlaceholder")}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {fixedType ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
              <p className="text-sm font-semibold text-brand-700">
                {typeOptions.find((opt) => opt.value === fixedType)?.title}
              </p>
              <p className="mt-1 text-xs text-brand-600">
                {typeOptions.find((opt) => opt.value === fixedType)?.description}
              </p>
            </div>
          ) : (
            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">{t("agent.wizard.typeQuestion")}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {typeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAgentType(option.value)}
                    className={`rounded-xl border p-4 text-left transition ${
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

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !agentType}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {creating ? t("agent.wizard.creating") : t("agent.wizard.nextArrow")}
            </button>
          </div>
        </div>
      ) : null}

      {currentKey === "knowledge" && widget ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{t("agent.wizard.knowledgeTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("agent.wizard.knowledgeDescription")}</p>
          </div>
          <KnowledgeBaseTab
            widget={widget}
            onSourcesChange={(knowledgeBase) =>
              setWidget((prev) => (prev ? { ...prev, extra: { ...prev.extra, knowledgeBase } } : prev))
            }
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={goNext}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("common.skip")}
            </button>
            <button
              type="button"
              onClick={goNext}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t("agent.wizard.nextArrow")}
            </button>
          </div>
        </div>
      ) : null}

      {currentKey === "prompt" && widget ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{t("agent.wizard.promptTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {(widget.extra.knowledgeBase?.length ?? 0) > 0
                ? t("agent.wizard.promptDescriptionWithKnowledge", { count: widget.extra.knowledgeBase!.length })
                : t("agent.wizard.promptDescription")}
            </p>
          </div>
          <PromptLabTab widget={widget} savePatch={savePatch} />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={goNext}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("common.skip")}
            </button>
            <button
              type="button"
              onClick={goNext}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t("agent.wizard.nextArrow")}
            </button>
          </div>
        </div>
      ) : null}

      {currentKey === "voice" && widget ? (
        <div className="space-y-4">
          <WizardVoiceStep
            widget={widget}
            llmModels={llmModels}
            voiceModels={voiceModels}
            savePatch={savePatch}
            onNext={goNext}
          />
          <button
            type="button"
            onClick={goNext}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("common.skip")}
          </button>
        </div>
      ) : null}

      {currentKey === "calendar" && widget ? <WizardCalendarStep widget={widget} onNext={goNext} /> : null}
      {currentKey === "webshop" && widget ? <WizardWebshopStep widget={widget} onNext={goNext} /> : null}

      {/* Try the finished agent on a stand-in website before being asked to
          pay for it — the same preview the Test Agent tab shows later. */}
      {currentKey === "test" && widget ? (
        <div className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{t("agent.wizard.testTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("agent.wizard.testDescription")}</p>
          </div>
          <TestAgentTab widget={widget} />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep((prev) => Math.max(prev - 1, 0))}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("agent.wizard.backArrow")}
            </button>
            <button
              type="button"
              onClick={goNext}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              {t("agent.wizard.testDoneNext")}
            </button>
          </div>
        </div>
      ) : null}

      {currentKey === "payment" && widget ? (
        <div className="space-y-4">
          <WizardPaymentStep
            widget={widget}
            unlocked={embedCodeUnlocked}
            trialDaysRemaining={trialDaysRemaining}
            pkg={pkg}
          />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep((prev) => Math.max(prev - 1, 0))}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("agent.wizard.backArrow")}
            </button>
            <button
              type="button"
              onClick={handleFinish}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("agent.wizard.finish")}
            </button>
          </div>
        </div>
      ) : null}

      {currentKey === "phone" && widget ? (
        <div className="space-y-4">
          <WizardPhoneStep widget={widget} />
          <button
            type="button"
            onClick={handleFinish}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {t("agent.wizard.finish")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
