import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(secretKey: string): Stripe {
  return (_stripe ??= new Stripe(secretKey))
}
