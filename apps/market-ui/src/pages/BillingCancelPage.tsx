import { useNavigate } from 'react-router-dom';
import { XCircle } from 'lucide-react';

export default function BillingCancelPage() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen bg-[color:var(--bg)] flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center space-y-6">
                <div className="flex justify-center">
                    <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
                        <XCircle className="w-8 h-8 text-zinc-400" />
                    </div>
                </div>
                <div className="space-y-2">
                    <h1 className="text-2xl font-semibold text-[color:var(--fg)]">Payment cancelled</h1>
                    <p className="text-zinc-400">No charge was made. You can upgrade whenever you're ready.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        onClick={() => navigate('/billing')}
                        className="px-6 py-2.5 rounded-lg bg-[color:var(--accent)] text-black font-semibold text-sm hover:opacity-90 transition-opacity"
                    >
                        View plans
                    </button>
                    <button
                        onClick={() => navigate('/search')}
                        className="px-6 py-2.5 rounded-lg border border-zinc-700 text-[color:var(--fg)] text-sm hover:bg-zinc-800 transition-colors"
                    >
                        Back to search
                    </button>
                </div>
            </div>
        </div>
    );
}
