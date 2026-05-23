# csi-opsx Explore

Combines `/opsx:explore` and `grill-with-docs` behaviors in a      
single session. Both are active simultaneously from the start.

## Explore Behavior

Follow `/opsx:explore` behavior: conduct an investigative          
conversation. Do not make implementation decisions. Do not commit  
any artifacts during this session.

## Grill Behavior (active simultaneously)

Load and follow the `grill-with-docs` skill for grilling behavior.
If it is not installed, apply the fallback behaviors described     
below.

**Fallback grilling behaviors:**

- Challenge terminology against the existing glossary in           
  `CONTEXT.md` at the project root. When divergence is detected,     
  propose a canonical term and ask the user to confirm it.
- Stress-test the plan with concrete scenarios: "What happens when
  X and Y occur simultaneously?" "What does this look like at 10×    
  current scale?"
- Cross-reference stated behavior against actual code — if a claim
  about how the system behaves does not match what the code does,    
  surface that contradiction explicitly.
- Update `CONTEXT.md` at the project root inline as decisions      
  crystallise.
- Create ADRs under `docs/adr/` only for decisions that are: hard  
  to reverse, surprising without context, and involve genuine        
  trade-offs.

## Outputs

- `CONTEXT.md` at the project root updated inline as the session   
  progresses
- ADRs created only where all three ADR criteria are met
- No other artifacts produced or committed during explore

## Session End

When the user signals the session is wrapping up, surface:

> "Ready to proceed? Run `/csi-opsx:propose` to formalise these    
decisions into OpenSpec artifacts."