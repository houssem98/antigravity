import { forwardRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Loader2, ArrowRight } from 'lucide-react';
import { supabase } from '../../services/supabase';

/*
Supabase table DDL (run once in Supabase SQL editor):

create table if not exists investor_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text,
  role text,
  firm text,
  aum_range text,
  interest text,
  is_accredited boolean default false,
  notes text,
  created_at timestamptz default now()
);

create index if not exists investor_waitlist_created_at_idx
  on investor_waitlist (created_at desc);
*/

type FormState = {
    email: string;
    name: string;
    role: string;
    firm: string;
    aum_range: string;
    interest: string;
    is_accredited: boolean;
    notes: string;
};

const INITIAL: FormState = {
    email: '',
    name: '',
    role: '',
    firm: '',
    aum_range: '',
    interest: '',
    is_accredited: false,
    notes: '',
};

const ROLES = ['Analyst', 'PM', 'Founder', 'VC', 'Active Trader', 'Other'];
const AUM = ['<$10M', '$10M–$100M', '$100M–$1B', '$1B+'];
const INTEREST = ['Research', 'Trading', 'Both', 'Platform/API'];

type FieldProps = {
    label: string;
    children: React.ReactNode;
    required?: boolean;
};

function Field({ label, children, required }: FieldProps) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.08em] text-[#A7B0C8]/70 font-medium">
                {label}
                {required && <span className="text-[#00F0FF] ml-1">*</span>}
            </span>
            {children}
        </label>
    );
}

const inputClass =
    'bg-[#070A12]/70 border border-[rgba(255,255,255,0.08)] rounded-xl px-4 py-3 text-sm text-[#F4F6FF] placeholder:text-[#A7B0C8]/40 outline-none focus:border-[rgba(0,240,255,0.45)] transition-colors';

const WaitlistForm = forwardRef<HTMLElement>(function WaitlistForm(_props, ref) {
    const [form, setForm] = useState<FormState>(INITIAL);
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);

    const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm((prev) => ({ ...prev, [key]: value }));

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.email.trim()) {
            setError('Email is required.');
            return;
        }
        setStatus('loading');
        setError(null);

        const payload = {
            email: form.email.trim().toLowerCase(),
            name: form.name.trim() || null,
            role: form.role || null,
            firm: form.firm.trim() || null,
            aum_range: form.aum_range || null,
            interest: form.interest || null,
            is_accredited: form.is_accredited,
            notes: form.notes.trim() || null,
        };

        const { error: insertError } = await supabase
            .from('investor_waitlist')
            .insert(payload);

        if (insertError) {
            setStatus('error');
            setError(
                insertError.code === '23505'
                    ? 'This email is already on the list.'
                    : insertError.message || 'Something went wrong. Try again.',
            );
            return;
        }

        setStatus('success');
    };

    return (
        <section
            ref={ref}
            id="waitlist"
            className="relative z-10 py-24 px-6 border-t border-[rgba(0,240,255,0.08)]"
            style={{
                background:
                    'radial-gradient(ellipse at 50% 0%, rgba(0,240,255,0.06), transparent 60%), #070A12',
            }}
        >
            <div className="max-w-3xl mx-auto">
                <div className="text-center mb-12">
                    <span className="text-xs uppercase tracking-[0.14em] text-[#00F0FF] font-medium mb-3 block">
                        Request access
                    </span>
                    <h2 className="text-3xl md:text-5xl font-bold mb-4 tracking-tight">
                        Get into the waitlist.
                    </h2>
                    <p className="text-[#A7B0C8] max-w-xl mx-auto">
                        We respond to investors within 48 hours. Operators and
                        design partners are reviewed weekly.
                    </p>
                </div>

                <AnimatePresence mode="wait">
                    {status === 'success' ? (
                        <motion.div
                            key="success"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            className="p-10 rounded-2xl text-center border border-[rgba(0,240,255,0.25)]"
                            style={{
                                background:
                                    'linear-gradient(135deg, rgba(0,240,255,0.08), rgba(138,180,248,0.04))',
                            }}
                        >
                            <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-[rgba(0,240,255,0.12)] border border-[rgba(0,240,255,0.35)] flex items-center justify-center">
                                <Check className="w-6 h-6 text-[#00F0FF]" />
                            </div>
                            <h3 className="text-xl md:text-2xl font-bold mb-2">
                                You're in.
                            </h3>
                            <p className="text-[#A7B0C8]">
                                We'll be in touch within 48 hours.
                            </p>
                        </motion.div>
                    ) : (
                        <motion.form
                            key="form"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            onSubmit={onSubmit}
                            className="p-6 md:p-8 rounded-2xl border border-[rgba(255,255,255,0.07)] flex flex-col gap-5"
                            style={{ background: 'rgba(255,255,255,0.025)' }}
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Field label="Email" required>
                                    <input
                                        type="email"
                                        required
                                        className={inputClass}
                                        placeholder="you@fund.com"
                                        value={form.email}
                                        onChange={(e) => update('email', e.target.value)}
                                    />
                                </Field>
                                <Field label="Name">
                                    <input
                                        type="text"
                                        className={inputClass}
                                        placeholder="Full name"
                                        value={form.name}
                                        onChange={(e) => update('name', e.target.value)}
                                    />
                                </Field>
                                <Field label="Role">
                                    <select
                                        className={inputClass}
                                        value={form.role}
                                        onChange={(e) => update('role', e.target.value)}
                                    >
                                        <option value="">Select role</option>
                                        {ROLES.map((r) => (
                                            <option key={r} value={r}>
                                                {r}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Firm">
                                    <input
                                        type="text"
                                        className={inputClass}
                                        placeholder="Optional"
                                        value={form.firm}
                                        onChange={(e) => update('firm', e.target.value)}
                                    />
                                </Field>
                                <Field label="AUM range">
                                    <select
                                        className={inputClass}
                                        value={form.aum_range}
                                        onChange={(e) => update('aum_range', e.target.value)}
                                    >
                                        <option value="">Optional</option>
                                        {AUM.map((r) => (
                                            <option key={r} value={r}>
                                                {r}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="Which surface?">
                                    <select
                                        className={inputClass}
                                        value={form.interest}
                                        onChange={(e) => update('interest', e.target.value)}
                                    >
                                        <option value="">Select interest</option>
                                        {INTEREST.map((r) => (
                                            <option key={r} value={r}>
                                                {r}
                                            </option>
                                        ))}
                                    </select>
                                </Field>
                            </div>

                            <label className="flex items-center gap-2.5 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    className="w-4 h-4 accent-[#00F0FF]"
                                    checked={form.is_accredited}
                                    onChange={(e) =>
                                        update('is_accredited', e.target.checked)
                                    }
                                />
                                <span className="text-sm text-[#A7B0C8]">
                                    I'm an accredited investor.
                                </span>
                            </label>

                            {error && (
                                <p className="text-sm text-[#FF6B6B]">{error}</p>
                            )}

                            <button
                                type="submit"
                                disabled={status === 'loading'}
                                className="mt-1 w-full bg-[#00F0FF] text-[#070A12] py-3.5 rounded-xl font-bold text-sm hover:bg-[#00F0FF]/90 active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {status === 'loading' ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Submitting…
                                    </>
                                ) : (
                                    <>
                                        Request investor access
                                        <ArrowRight className="w-4 h-4" />
                                    </>
                                )}
                            </button>

                            <p className="text-[11px] text-[#A7B0C8]/60 text-center">
                                We don't share your info. Used only to grant
                                platform access and send investor updates.
                            </p>
                        </motion.form>
                    )}
                </AnimatePresence>
            </div>
        </section>
    );
});

export default WaitlistForm;
