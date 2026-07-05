# EventOS – Full Product Specification

## Overview
AI-powered event planning and execution platform that allows users to build, order, and manage entire events with minimal input. The system combines:
- AI automation
- Supplier marketplace
- Unified cart + escrow payments
- Human concierge layer

Core promise:
> Choose → Approve → Pay → Track

---

## Core Concept
“Personal event manager that builds and executes everything for you.”

---

## User Flow

1. Select event type
2. Enter minimal data (date, budget, guests, location)
3. Choose style/mood (visual)
4. AI generates full event plan
5. User selects from 3 packages (Budget / Balanced / Premium)
6. System builds unified cart
7. User approves
8. Payment (deposit or full)
9. Execution tracking

---

## Event Types (MVP)
- Wedding
- Birthday
- Engagement
- Gift ordering

---

## Core Categories

### Venue & Logistics
- Hotel / hall
- Bus / transportation

### Food & Hospitality
- Catering
- Drinks
- Cake

### Decoration
- Balloons
- Car decor
- House decor
- Welcome CNC sign
- Flowers
- Lighting
- Stage setup

### Personal Items
- Suit
- Wedding dress
- Rings
- Gold

### Beauty & Services
- Salon
- Makeup
- Photographer
- Videographer
- DJ / sound system

### Additional Services
- Invitations (digital & printed)
- Seating chart
- Table numbers
- Guest list & RSVP
- Security
- Cleaning
- Generator
- AC rental

---

## Advanced Services
- Wedding website
- QR check-in
- Ticketing (future)
- Sponsorship management (future)
- Honeymoon planning (future)

---

## AI System

### Responsibilities
- Generate full event plan
- Assign budget
- Recommend suppliers
- Detect missing items
- Replace unavailable suppliers
- Create timeline
- Prepare unified cart

### Control Mode
Auto-select + user approval

---

## Supplier System

### Model
Hybrid (strict at start)

### Requirements
- Verified onboarding
- Portfolio
- Availability
- Pricing packages

### Supplier Types
- Venues
- Caterers
- Bakers
- Decorators
- Photographers
- CNC / laser workshops
- Gift shops
- Transport services

---

## Marketplace Structure
Micro-market inside each category:
- Visual selection
- 3–5 options per item
- Add to cart

---

## Ordering System

Order states:
- Draft
- Approved
- Paid
- Confirmed
- In progress
- Delivered
- Completed

---

## Payment System

### Model
Escrow (platform holds funds)

### Rules
- Default deposit: 30%
- Remaining before event

### Methods
- Cash on delivery
- ZainCash
- Qi Card
- Bank transfer (later)
- Wallet system

---

## Human Assistant

### Trigger
- Free for events > $5000
- Paid upgrade for smaller events

### Communication
- WhatsApp (primary)
- In-app chat

### Role
- Validate suppliers
- Manage issues
- Assist customization

---

## UX Principles

- No typing
- Visual-first decisions
- Step-by-step roadmap
- Minimal friction

---

## Key Features

### 1. One-click event generation
“Build my event”

### 2. Unified event cart
All services in one place

### 3. Smart replacement
Auto-switch suppliers if needed

### 4. Budget tracking
Live updates

### 5. Timeline engine
Auto scheduling

### 6. Confidence system
- All items covered
- Budget optimized
- Timeline ready

### 7. Progress bar
Planning → Booking → Confirmed → Ready

---

## Special Features

### Mood-based entry
User chooses feeling:
- Romantic
- Luxury
- Simple
- Fun

### Couple mode
Shared decision making

### Family approval mode
Parents can approve key decisions

---

## Logistics Engine

Handles:
- Delivery timing
- Setup scheduling
- Distance constraints

---

## Your Workshop Integration

- Featured supplier
- Fast delivery badge
- Custom CNC products

---

## Monetization

- Supplier commission
- Featured listings
- Concierge service
- Delivery fees
- Premium packages
- Custom production

---

## Geography Plan

- Phase 1: Basra
- Phase 2: Baghdad
- Phase 3: GCC

---

## Notifications

- WhatsApp
- Push notifications

---

## Language

- Arabic first (Iraqi dialect UX)
- English later

---

## Legal System

Platform-controlled:
- Cancellation
- Refunds
- Supplier penalties

---

## Tech Stack

### Frontend
- Web: React / Next.js
- Mobile: Flutter or React Native

### Backend
- Node.js (NestJS) or Laravel
- PostgreSQL
- Redis

### AI
- OpenAI API
- Tool-based architecture

---

## MVP Scope

Start with:
- Weddings
- Birthdays
- Gifts
- Engagements

Limit suppliers and features for quality control.

---

## Product Vision

Build the first system in the region that:
- Plans events
- Orders everything
- Manages payments
- Tracks execution
- Replaces suppliers automatically

---

## Final Note

This is not just a planner.

This is an Event Operating System.
