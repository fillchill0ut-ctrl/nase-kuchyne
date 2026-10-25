# Naše kuchyně

Rodinná aplikace na týdenní jídelníček podle akcí v obchodech, nákupní seznam a recepty.

- **Aplikace:** statická webová aplikace (PWA) na GitHub Pages – `index.html`, `src/data-layer.js`, `sw.js`.
- **Data:** Supabase (tabulky `recipes`, `items`, `docs`, přístup jen pro e-maily v `members`). Struktura je v `supabase/schema.sql`.
- **Plánování:** každou neděli Claude vytvoří plán, recepty a nákupní seznam a zapíše je do Supabase.

V kódu je jen veřejný „publishable“ klíč Supabase. Data chrání přihlášení a pravidla přístupu v databázi, ne utajení klíče.
