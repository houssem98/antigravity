import { useRef } from 'react';
import Hero from '../components/investors/Hero';
import Problem from '../components/investors/Problem';
import Wedge from '../components/investors/Wedge';
import TwoSurfaces from '../components/investors/TwoSurfaces';
import LiveProduct from '../components/investors/LiveProduct';
import Moat from '../components/investors/Moat';
import Traction from '../components/investors/Traction';
import Market from '../components/investors/Market';
import BusinessModel from '../components/investors/BusinessModel';
import BuiltOn from '../components/investors/BuiltOn';
import Roadmap from '../components/investors/Roadmap';
import WaitlistForm from '../components/investors/WaitlistForm';
import Footer from '../components/investors/Footer';

export default function InvestorsPage() {
    const waitlistRef = useRef<HTMLElement>(null);

    const scrollToWaitlist = () =>
        waitlistRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    return (
        <div className="relative bg-[#070A12] text-[#F4F6FF] min-h-screen font-sans">
            <Hero onScrollToWaitlist={scrollToWaitlist} />
            <Problem />
            <Wedge />
            <TwoSurfaces />
            <LiveProduct />
            <Moat />
            <Traction />
            <Market />
            <BusinessModel />
            <BuiltOn />
            <Roadmap />
            <WaitlistForm ref={waitlistRef} />
            <Footer />
        </div>
    );
}
