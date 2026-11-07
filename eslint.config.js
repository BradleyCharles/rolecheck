import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "lab", "node_modules", "results", ".rolecheck"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
