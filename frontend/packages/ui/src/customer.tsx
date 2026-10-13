"use client"
import {Hero,FeaturedServices,ProcessSection,BenefitsSection,FaqSection,CtaSection} from '@/components/customer/home-sections'
export function Home(){return <div className="ch-home"><Hero/><FeaturedServices/><ProcessSection/><BenefitsSection/><FaqSection/><CtaSection/></div>}
export { Services } from '@/components/customer/service-pages'
export { CustomerBooking as Booking } from '@/components/customer/customer-booking'
