import { codeToHtml } from "rangi/core";
import {
  bash,
  html,
  js,
  js_template_literals,
  jsdoc,
  regex,
  todo,
  ts,
} from "rangi/languages";
import { catppuccin } from "rangi/themes";

const languages = {
  bash,
  html,
  js,
  js_template_literals,
  jsdoc,
  regex,
  sh: bash,
  todo,
  ts,
};

export const highlight = (code: string, lang: string) =>
  codeToHtml(code, {
    lang,
    languages,
    lineNumbers: false,
    theme: catppuccin,
  });
