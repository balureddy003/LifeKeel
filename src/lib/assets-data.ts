export interface AssetOwner {
  name: string
  share: number
}

export interface AssetInsight {
  text: string
  status: 'good' | 'warning'
}

export interface AssetInsurance {
  label: string
  active: boolean
}

export interface AssetProfile {
  id: string
  label: string
  icon: 'House' | 'TrendingUp' | 'Landmark'
  marketValue: number
  mortgageRemaining?: number
  owners: AssetOwner[]
  insurance?: AssetInsurance[]
  insights: AssetInsight[]
  actions: string[]
}

export const ASSETS: Record<string, AssetProfile> = {
  home: {
    id: 'home',
    label: 'Family Home',
    icon: 'House',
    marketValue: 950000,
    mortgageRemaining: 420000,
    owners: [
      { name: 'Dad', share: 50 },
      { name: 'Mom', share: 50 },
    ],
    insurance: [
      { label: 'Building', active: true },
      { label: 'Contents', active: true },
    ],
    insights: [
      { text: 'Adequately insured', status: 'good' },
      { text: 'Property appreciated 8% this year', status: 'good' },
      { text: 'Mortgage fixed rate expires in 9 months', status: 'warning' },
    ],
    actions: ['Sell', 'Refinance', 'Insurance', 'Inheritance'],
  },
  investments: {
    id: 'investments',
    label: 'Investments',
    icon: 'TrendingUp',
    marketValue: 245000,
    owners: [{ name: 'Dad', share: 100 }],
    insights: [
      { text: 'Grew 12% this year — $45,000 in gains', status: 'good' },
      { text: 'Diversified across index funds and bonds', status: 'good' },
      { text: 'No rebalancing in the last 18 months', status: 'warning' },
    ],
    actions: ['Rebalance', 'Withdraw', 'Add Funds', 'Inheritance'],
  },
  pension: {
    id: 'pension',
    label: 'Pension',
    icon: 'Landmark',
    marketValue: 180000,
    owners: [{ name: 'Dad', share: 100 }],
    insights: [
      { text: 'Employer match fully utilized', status: 'good' },
      { text: '55% of target for retirement at 60', status: 'warning' },
      { text: 'Adding $300/month keeps you on track', status: 'warning' },
    ],
    actions: ['Increase Contribution', 'Change Provider', 'Survivor Benefits', 'Inheritance'],
  },
}
