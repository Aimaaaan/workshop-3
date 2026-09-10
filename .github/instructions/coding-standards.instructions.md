---
description: 'Shared comment, documentation, and TypeScript coding standards'
applyTo: '**/*.{ts,astro}'
---

# Coding Standards

## Comments and documentation

- Comment intent, constraints, and non-obvious decisions — explain **why** the code exists rather than restating **what** the code does.
- Do not add comments that merely paraphrase the next line of code. Prefer clear names and small functions for behavior that is already self-explanatory.
- Keep comments current. When changing the related code, update comments whose reasoning or assumptions changed, or remove comments that are no longer useful.
- Use TSDoc/JSDoc for every exported function in `db/` and `src/lib/`. Describe the function's purpose, every parameter (including the injectable `db` argument), and the returned value. Document meaningful errors or side effects when they are part of the contract.
- Reusable Astro components must define a typed `Props` interface in frontmatter and document the component's public props when their purpose or constraints are not obvious from the types.

Example:

```ts
/**
 * Returns games in stable title order for deterministic static builds.
 *
 * @param db - The injectable Drizzle database used for the query.
 * @returns All games mapped to the app-facing game shape.
 */
export async function getAllGames(db: Database): Promise<Game[]> {
  // Stable ordering keeps generated pages reproducible between builds.
  return [];
}
```

## TypeScript formatting

- Use single quotes, semicolons, trailing commas in multiline structures, and spaces inside object or import braces.
- Prefer one logical statement per line and preserve readable line breaks for multiline parameters, objects, and arrays.
- Use `import type` for type-only imports and explicit parameter and return types for exported functions, especially in `db/` and `src/lib/`.
- Follow the ESLint configuration as the source of truth for formatting enforcement; do not introduce a separate formatter configuration without updating the repository guidance.
