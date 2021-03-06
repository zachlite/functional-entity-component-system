import * as _ from "lodash";
import {
  Entity,
  State,
  Vec3,
  Message,
  MessageType,
  InputMessage,
  CollisionEndMessage,
  CollisionStartMessage,
  CollisionActiveMessage,
  Collider,
  TriggerActiveMessage,
  InputRequest,
  MeshTypes,
  SceneTransitionMessage
} from "./interfaces";
import { FRAME } from "./constants";
import { degreeToRadian } from "./math";
import { getMessages } from "./message";
import { collisionSystem } from "./collision";

// interface Message {
//   type: string;
//   data: any;
// }

interface Logic
  extends Array<
    [
      (e: Entity) => boolean,
      (entity: Entity, messages: Message[]) => [Entity, Message[]]
    ]
  > {}

function playerMovement(
  entity: Entity,
  messages: Message[]
): [Entity, Message[]] {
  // TODO: create message on flap

  // check to see if there is input for this entity!
  const inputForEntity: InputMessage = messages.find(
    (message: InputMessage) =>
      message.subject === MessageType.INPUT && message.clientId === entity.id
  ) as InputMessage;
  // if there is input for this entity, proceed.
  // else, return entity
  // exercise in good component design
  // i.e. this is less 'player movement' system, and more 'controllable' system

  if (!inputForEntity) {
    return [entity, []];
  }

  // save position
  const lastPosition = { ...entity.body.transform.position };

  const input = inputForEntity.input;

  const activeCollisionX = _.find(
    messages,
    (message: CollisionActiveMessage) =>
      message.subject === MessageType.COLLISION_ACTIVE &&
      _.includes(message.entityIds, entity.id) &&
      message.axisOfCollision === "x"
  );

  const activeCollisionZ = _.find(
    messages,
    (message: CollisionActiveMessage) =>
      message.subject === MessageType.COLLISION_ACTIVE &&
      _.includes(message.entityIds, entity.id) &&
      message.axisOfCollision === "z"
  );

  // Velocity
  const v = 0.001;
  const direction = input.forward ? 1 : -1;
  const thrust = input.forward || input.back ? 1 : 0;

  const vz =
    entity.body.velocity.z +
    thrust *
      direction *
      v *
      Math.sin(degreeToRadian(entity.body.transform.rotation.y - 90));

  const vx =
    entity.body.velocity.x +
    thrust *
      direction *
      v *
      Math.cos(degreeToRadian(entity.body.transform.rotation.y + 90));

  const vyFlap = input.flap
    ? entity.body.velocity.y + 0.06
    : entity.body.velocity.y;

  // decay
  const decay = (v: number) => (Math.abs(v) < 0.00001 ? 0 : v * 0.99);

  const velocity = {
    x: activeCollisionX ? entity.body.velocity.x : decay(vx),
    y: vyFlap,
    z: activeCollisionZ ? entity.body.velocity.z : decay(vz)
  };

  // Position
  const dy = velocity.y * FRAME;
  const dx = velocity.x * FRAME;
  const dz = velocity.z * FRAME;

  const position: Vec3 = {
    y: entity.body.transform.position.y + dy,
    x: entity.body.transform.position.x + dx,
    z: entity.body.transform.position.z + dz
  };

  // Rotation
  const dRotY = input.left ? 1 : input.right ? -1 : 0;
  const rotation = {
    ...entity.body.transform.rotation,
    y: entity.body.transform.rotation.y + dRotY
  };

  const transform = {
    ...entity.body.transform,
    position,
    rotation,
    lastPosition
  };
  return [{ ...entity, body: { ...entity.body, transform, velocity } }, []];
}

// function playerHealth(
//   entity: Entity,
//   messages: Message[]
// ): [Entity, Message[]] {
//   const collisions = messages.filter(
//     message =>
//       message.type === "COLLISION" &&
//       (message.data.a === entity.id || message.data.b === entity.id)
//   );

//   const health = collisions.reduce((acc, curr) => {
//     return acc - 1;
//   }, entity.health.amount);

//   return [{ ...entity, health: { amount: health } }, []];
// }

function collisionStart(
  entity: Entity,
  messages: Message[]
): [Entity, Message[]] {
  const collisions = messages.filter(
    (message: CollisionStartMessage) =>
      message.subject === MessageType.COLLISION_START &&
      _.includes(message.entityIds, entity.id)
  ) as CollisionStartMessage[];

  // TODO: deal with more than 1 simultaneous collision.
  // thought: if I only respond to 1 collision, will the 2nd collision still exist next frame?

  const adjustVelocity = (axis: string, damping: number = 1) => {
    const damped = damping * entity.body.velocity[axis];
    const capped = Math.abs(damped) < 0.001 ? 0 : damped;
    return collisions[0].axisOfCollision === axis ? capped * -1 : capped;
  };

  const adjustedVelocity = collisions.length
    ? {
        x: adjustVelocity("x"),
        y: adjustVelocity("y", 0.5),
        z: adjustVelocity("z")
      }
    : entity.body.velocity;

  const body = { ...entity.body, velocity: adjustedVelocity };

  const updatedEntity: Entity = {
    ...entity,
    body
  };

  return [updatedEntity, []];
}

function gravityField(
  entity: Entity,
  messages: Message[]
): [Entity, Message[]] {
  // all entities with mass should experience a downwards acceleration of 9.8 m/s/s

  const GRAVITY = 0.0001;

  // only update velocity if entity is not invovled in a collision on the y axis.
  const activeCollision = _.find(
    messages,
    (message: CollisionActiveMessage) =>
      message.subject === MessageType.COLLISION_ACTIVE &&
      _.includes(message.entityIds, entity.id) &&
      message.axisOfCollision === "y"
  );

  const initialCollision = _.find(
    messages,
    (message: CollisionStartMessage) =>
      message.subject === MessageType.COLLISION_START &&
      _.includes(message.entityIds, entity.id) &&
      message.axisOfCollision === "y"
  );

  const velocityWithGravity =
    activeCollision || initialCollision
      ? { ...entity.body.velocity }
      : {
          ...entity.body.velocity,
          y: entity.body.velocity.y - GRAVITY * FRAME
        };

  const newBody = { ...entity.body, velocity: velocityWithGravity };
  const newEntity = { ...entity, body: newBody };

  return [newEntity, []];
}

function updateColliderTransform(
  entity: Entity,
  messages: Message[]
): [Entity, Message[]] {
  const collider: Collider = {
    ...entity.collider,
    position: { ...entity.body.transform.position }
  };

  const updated = {
    ...entity,
    collider
  };

  return [updated, []];
}

function updateColliderDebugInfo(
  entity: Entity,
  messages: Message[]
): [Entity, Message[]] {
  const collisionStart = _.find(
    messages,
    (message: CollisionStartMessage) =>
      message.subject === MessageType.COLLISION_START &&
      _.includes(message.entityIds, entity.id)
  );

  const collisionActive = _.find(
    messages,
    (message: CollisionActiveMessage) =>
      message.subject === MessageType.COLLISION_ACTIVE &&
      _.includes(message.entityIds, entity.id)
  );

  const triggerActive = _.find(
    messages,
    (message: TriggerActiveMessage) =>
      message.subject === MessageType.TRIGGER_ACTIVE &&
      (message.entityId === entity.id || message.triggerId === entity.id)
  );

  const updatedEntity = {
    ...entity,
    collider: {
      ...entity.collider,
      debug__activeCollision:
        collisionStart !== undefined ||
        collisionActive !== undefined ||
        triggerActive !== undefined
    }
  };

  return [updatedEntity, []];
}

function scoreUpdater(
  entity: Entity,
  messages: Message[]
): [Entity, Message[]] {
  // assume the only triggers are coins.
  const touchedCoin = messages.find(
    (m: TriggerActiveMessage) =>
      m.subject === MessageType.TRIGGER_ACTIVE && m.entityId === entity.id
  )
    ? true
    : false;

  const updatedEntity = touchedCoin
    ? { ...entity, score: entity.score + 1 }
    : entity;

  return [updatedEntity, []];
}

function deactivateCoin(
  entity: Entity,
  messages: Message[]
): [Entity, Message[]] {
  // assume the only triggers are coins.
  const coinTouched = messages.find(
    (m: TriggerActiveMessage) =>
      m.subject === MessageType.TRIGGER_ACTIVE && m.triggerId === entity.id
  )
    ? true
    : false;

  const updatedEntity = coinTouched
    ? { ...entity, isActive: false, coin: { timeSinceDeactivation: 0 } }
    : entity;

  return [updatedEntity, []];
}

function rotateCoin(entity: Entity, messages: Message[]): [Entity, Message[]] {
  const newRotation = {
    ...entity.body.transform.rotation,
    y: entity.body.transform.rotation.y + 0.5
  };

  const newTransform = {
    ...entity.body.transform,
    rotation: newRotation
  };

  const newBody = {
    ...entity.body,
    transform: newTransform
  };

  return [
    {
      ...entity,
      body: newBody
    },
    []
  ];
}

function reactivateCoin(
  entity: Entity,
  messages: Message[]
): [Entity, Message[]] {
  // if a sufficient amount of time has passed since the coin was deactivated, reactivate.

  const updatedEntity =
    !entity.isActive && entity.coin.timeSinceDeactivation > 625
      ? {
          ...entity,
          isActive: true
        }
      : {
          ...entity,
          coin: {
            ...entity.coin,
            timeSinceDeactivation: entity.coin.timeSinceDeactivation + 1
          }
        };

  return [updatedEntity, []];
}

function tickClock(entity: Entity, messages: Message[]): [Entity, Message[]] {
  const currentTime = Date.now();

  const lastTime =
    entity.timer.lastTime === 0 ? currentTime : entity.timer.lastTime;
  const diff = currentTime - lastTime;

  const timeRemaining = entity.timer.timeRemaining - diff;

  const nextEntity = {
    ...entity,
    timer: {
      lastTime: currentTime,
      timeRemaining
    }
  };

  const newMessages =
    timeRemaining < 0
      ? [{ subject: MessageType.SCENE_TRANSITION, scene: "GAME_OVER" }]
      : [];

  return [nextEntity, newMessages as SceneTransitionMessage[]];
}

function sceneManager(
  entity: Entity,
  messages: Message[]
): [Entity, Message[]] {
  // if there is a game over message, transition to GAME_OVER

  const transition = messages.find(
    m => m.subject === MessageType.SCENE_TRANSITION
  ) as SceneTransitionMessage;

  return transition
    ? [{ ...entity, sceneManager: { currentScene: transition.scene } }, []]
    : [entity, []];
}

function system(
  state: State,
  messages: Message[],
  participants: (e: Entity) => boolean,
  update: (e: Entity, m: Message[]) => [Entity, Message[]]
): [State, Message[]] {
  const [entitiesWithComponent, entitiesWithout] = _.partition(
    state,
    participants
  );

  const updates: [Entity, Message[]][] = entitiesWithComponent.map(entity =>
    update(entity, messages)
  );

  const updatedEntities = updates.map(u => u[0]);
  const newMessages = _.flatten(updates.map(u => u[1]));
  const newState = [...updatedEntities, ...entitiesWithout];

  return [newState, newMessages];
}

export function step(
  state: State,
  inputRequests: InputRequest[]
): { state: State; messages: Message[] } {
  const collisions = collisionSystem(
    state.filter(entity => entity.collider !== undefined && entity.isActive)
  );

  const inputMessages: Message[] = inputRequests.map(ir => {
    return {
      subject: MessageType.INPUT,
      input: ir.input,
      clientId: ir.clientId
    };
  });

  const messages = [...collisions, ...inputMessages];
  return { ...getNextState(state, messages) };
}

function getNextState(state: State, messages: Message[]) {
  const logic: Logic = [
    [(e: Entity) => e.body !== undefined && e.body.useGravity, gravityField],
    [
      (e: Entity) => e.collider !== undefined && e.collider.debug__drawOutline,
      updateColliderDebugInfo
    ],
    [
      (e: Entity) => e.collider !== undefined && e.body !== undefined,
      collisionStart
    ],
    [(e: Entity) => e.type === "PLAYER", playerMovement],
    [(e: Entity) => e.score !== undefined, scoreUpdater],
    [(e: Entity) => e.type === "COIN", rotateCoin],
    [(e: Entity) => e.type === "COIN", deactivateCoin],
    [(e: Entity) => e.type === "COIN", reactivateCoin],
    [
      (e: Entity) => e.collider !== undefined && e.body !== undefined,
      updateColliderTransform
    ],
    [(e: Entity) => e.type === "TIMER", tickClock],
    [(e: Entity) => e.type === "SCENE_MANAGER", sceneManager]
  ];

  // seed initial state with coins. done
  // if there's a trigger active message between a player and a coin,
  // increase the player's score by 1
  // remove the coin from state
  // make a new coin on top of an available cube.
  //

  const nextState = logic.reduce(
    (acc, curr) => {
      const predicate = curr[0];
      const fn = curr[1];
      const [newState, newMessages] = system(
        acc.state,
        acc.messages,
        predicate,
        fn
      );
      return { state: newState, messages: [...acc.messages, ...newMessages] };
    },
    {
      state,
      messages
    }
  );

  return nextState;
}
