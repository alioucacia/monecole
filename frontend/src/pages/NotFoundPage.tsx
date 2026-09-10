import { Link } from "react-router-dom";

import { Button } from "../components/ui";

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="h-20 w-20 rounded-2xl2 bg-gradient-to-br from-brand-500 to-brand-700 text-white flex items-center justify-center text-4xl shadow-soft mb-5">
        🔍
      </div>
      <h1 className="text-2xl font-extrabold text-ink-900 tracking-tight">Page introuvable</h1>
      <p className="text-slate-500 mt-2">La page que vous recherchez n'existe pas.</p>
      <Link to="/" className="mt-5">
        <Button>Retour au tableau de bord</Button>
      </Link>
    </div>
  );
}
