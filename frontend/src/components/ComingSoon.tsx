import { GroceryIcon, PantryIcon } from "./Icons";

// Placeholder pages until each section is built (the plan is in README.md)
const PAGES = {
  grocery: { title: "Grocery", icon: GroceryIcon, text: "Shopping lists sorted by aisle, shared with your household as you shop.", next: "Coming after the meal plan." },
  pantry: { title: "Pantry", icon: PantryIcon, text: "What you have at home, so lists skip it and you can cook with what's there.", next: "Coming with the grocery list." },
} as const;

export default function ComingSoon({ page }: { page: keyof typeof PAGES }) {
  const p = PAGES[page];
  const Icon = p.icon;
  return (
    <div className="mx-auto max-w-[960px] px-3 pb-16 pt-4 sm:px-6">
      <h1 className="text-2xl font-semibold">{p.title}</h1>
      <section className="mt-6 flex flex-col items-center rounded-2xl bg-container px-6 py-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-subtle text-action">
          <Icon className="size-8" />
        </span>
        <p className="mt-5 max-w-md text-lg">{p.text}</p>
        <p className="mt-2 text-subtle">{p.next}</p>
      </section>
    </div>
  );
}
