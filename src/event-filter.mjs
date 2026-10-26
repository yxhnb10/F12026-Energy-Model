// Copyright (c) 2026 ltnssss. SPDX-License-Identifier: MIT
export function stewardsMessage(text){return /INVESTIGAT|INCIDENT.*NOTED|NO FURTHER ACTION|REFERRED TO (?:THE )?STEWARDS|INFRINGEMENT|BREACH|PENALTY|REPRIMAND|DISQUALIFIED/i.test(text)}
