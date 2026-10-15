import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "apps/cloud-site/**", "packages/mammoth-api/**"] },
  ...tseslint.configs.recommended,
);
