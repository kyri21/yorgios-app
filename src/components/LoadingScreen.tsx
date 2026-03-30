export default function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-brand-navy border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-brand-navy font-semibold text-lg">Chargement…</p>
      </div>
    </div>
  );
}
