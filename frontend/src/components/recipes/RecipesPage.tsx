import { useEffect, useState } from "react";
import { recipeRoute, type RecipeRoute } from "../../recipes";
import RecipeList from "./RecipeList";
import RecipeView from "./RecipeView";
import RecipeEditor from "./RecipeEditor";
import CookMode from "./CookMode";

// #/recipes (the list), #/recipes/12 (a recipe), #/recipes/12/edit, #/recipes/new
export default function RecipesPage() {
  const [route, setRoute] = useState<RecipeRoute>(recipeRoute);
  useEffect(() => {
    const onHash = () => setRoute(recipeRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // (braces: scrollTo returns a promise in newer browsers, and an effect may only return a cleanup function)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route.view, "id" in route ? route.id : 0]);

  if (route.view === "away") return null;
  if (route.view === "recipe") return <RecipeView key={route.id} id={route.id} />;
  // (the edit screen is gone: an old edit link opens the recipe with its details ready to edit)
  if (route.view === "edit") return <RecipeView key={`edit-${route.id}`} id={route.id} startEditing />;
  if (route.view === "cook") return <CookMode key={`cook-${route.id}`} id={route.id} />;
  if (route.view === "new") return <RecipeEditor key="new" />;
  return <RecipeList params={route.params} />;
}
