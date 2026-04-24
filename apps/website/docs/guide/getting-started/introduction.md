---
title: Introduction
description: An introduction to ilha, a tiny isomorphic island framework with fine-grained signal reactivity.
---

# Introduction

ilha is a tiny, isomorphic island framework for building reactive UI components.

It lets you render on the server and mount in the browser with fine-grained signal reactivity, without a virtual DOM or compiler overhead. The result is a UI model that stays close to HTML, but still gives you state, events, lifecycle hooks, scoped styles, and hydration when you need them.

## What ilha is

An **island** is a self-contained component that knows how to render itself to HTML and how to activate itself in the browser. That means the same component can be used for server-side rendering, client-side mounting, or both together in a hydration flow.

ilha is built around a fluent builder chain. You declare input, state, derived values, event handlers, effects, transitions, and styles, then finish with [`.render()`](/guide/island/render) to produce a reusable component.

## Why it exists

Most UI stacks force you to choose between simplicity and interactivity. ilha tries to keep both: it gives you a small API surface, direct DOM updates through signals, and a rendering model that works naturally on the server.

This makes ilha a good fit when you want:

- Server-rendered markup.
- Small, focused interactive islands.
- Explicit state and behavior.
- No virtual DOM layer.
- A lightweight mental model for UI code.

## How it feels to use

A typical island reads a lot like a small HTML-aware module:

```ts twoslash
import ilha, { html } from "ilha";

const Counter = ilha
  .state("count", 0)
  .on("button@click", ({ state }) => state.count(state.count() + 1))
  .render(
    ({ state }) => html`
      <div>
        <p>Count: ${state.count()}</p>
        <button>Increment</button>
      </div>
    `,
  );
```

The same component can render to a string on the server and mount into the DOM on the client. That keeps the component logic in one place instead of splitting it across separate templates and client scripts.

## Core ideas

### Isomorphic rendering

ilha can produce HTML on the server and activate the same component in the browser. That makes it useful for SSR, hydration, and progressive enhancement.

### Fine-grained reactivity

State is handled with signals, so updates are targeted and local. You do not need to rerender an entire application tree just to change one value.

### HTML-first authoring

ilha uses tagged templates and direct HTML interpolation, which keeps markup readable and easy to scan. It also means the API feels familiar if you already think in terms of HTML and DOM.

### Builder-based composition

The fluent API lets you layer behavior step by step:

- [`.input()`](/guide/island/input) for typed props.
- [`.state()`](/guide/island/state) for local reactive state.
- [`.derived()`](/guide/island/derived) for computed values.
- [`.on()`](/guide/island/on) for events.
- [`.effect()`](/guide/island/effect) and [`.onMount()`](/guide/island/onmount) for side effects.
- [`.css()`](/guide/island/css) for scoped styles.
- [`.render()`](/guide/island/render) to finalize the component.

## When to use ilha

ilha is a strong fit when you want:

- Interactive UI with small, explicit components.
- SSR-friendly rendering without heavy framework machinery.
- A simple way to mix server output and client behavior.
- Reusable islands rather than one large application shell.

It is less about building a giant monolithic app framework and more about composing focused UI pieces that each own their own state and behavior.

## Basic mental model

Think of an island as a component with three parts:

- **Input**: data from the outside world.
- **State**: reactive values owned by the component.
- **Render**: HTML output driven by that state and input.

Then add behavior on top with events, effects, bindings, and lifecycle hooks. Once you understand that pattern, the rest of the API is mostly just different ways to connect those pieces.
