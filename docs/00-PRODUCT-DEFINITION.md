# 00 - Product Definition

## 1. Product name

**XMi**

Working expansion: **Idea-to-Executable-Spec Intelligence**.

## 2. Product problem

Coding agents can implement explicit software requirements, but nontechnical users often cannot convert an idea into:

- actors and permissions;
- concrete user flows;
- system states;
- functional requirements;
- edge and failure cases;
- data requirements;
- privacy/security constraints;
- external integrations;
- measurable acceptance criteria;
- a coherent technical solution boundary.

Without that structure, a coding agent must guess. The result may look complete while implementing a different product from the one the user intended.

## 3. Product promise

> The user speaks in ordinary language. XMi asks only high-value questions, makes uncertainty visible, obtains explicit decisions, checks completeness and exports an XSpec that XDev can implement without silently resolving product ambiguity.

## 4. Target user

Primary V0 user:

- a nontechnical founder, domain expert or independent builder;
- knows the problem and desired experience;
- can make product decisions when choices are explained in ordinary language;
- does not know how to write engineering requirements;
- wants to use XDev or another coding workflow after specification.

## 5. Product categories

The core interview, canonical Product Model, explicit Owner confirmation, provenance, audit and XSpec pipeline are shared across software categories and project sizes. Category capabilities select relevant questions and completeness rules; size changes depth and volume, not the truthfulness standard.

The initial Web App / Micro-SaaS profile remains supported. M12 adds a digital-game profile for single-player and multiplayer software on web, mobile and desktop. Other categories can be discussed, but a readiness claim still requires a matching completeness profile and every hard gate. Physical tabletop games are outside M12.

Owner-supplied design documents may start or continue discovery. Their claims remain unconfirmed until reviewed; the source file is retained by the Owner.

## 6. XMi is not

- a one-prompt PRD generator;
- a code generator;
- a UI design generator;
- a market-validation product;
- a replacement for XDev;
- a replacement for XMem;
- a guarantee that every business idea is viable;
- a tool that hides uncertainty behind confident prose.

## 7. Core principles

### 7.1 Owner intent over model creativity

The model may propose, infer and explain. It may not present those outputs as Owner-confirmed facts.

### 7.2 Conversation plus explicit state

Conversation discovers intent. The Product Model records it. The Product Model, not the transcript, is canonical.

### 7.3 Progressive clarification

Ask the smallest number of questions that materially reduce implementation ambiguity.

### 7.4 Visible epistemic status

Every meaningful statement has one status:

- `CONFIRMED`
- `INFERRED`
- `PROPOSED`
- `ASSUMED`
- `OPEN`
- `BLOCKING`
- `REJECTED`

### 7.5 Development readiness is a gate

A generated document is not automatically ready. XSpec must pass deterministic checks, profile checks and an independent audit.

### 7.6 Technical recommendations are choices, not hidden decisions

XMi explains a recommended solution, alternatives and trade-offs. Material decisions require Owner approval.

### 7.7 Bounded, replaceable platform adapters

XMi V0 uses OpenAI/ChatGPT/Codex as its initial interaction and execution ecosystem. Core domain rules remain independent of a specific chat surface.

## 8. Unified delivery-mode principle

XMi is the normal place where the Owner selects the suite delivery mode once. The user chooses an intended result, not Agent topology:

- `FAST_VALIDATION`: prototype/idea validation;
- `FAST_DEVELOPMENT`: reviewed MVP/internal or early-user use;
- `PRODUCT_GRADE`: public, paid or long-term release-candidate intent.

XMi changes interview/specification/audit depth accordingly, exports the mode in XSpec, and never asks the user to separately configure XUi, XDev or XMem. Full rules are normative in `18-UNIFIED-DELIVERY-MODES.md`.
