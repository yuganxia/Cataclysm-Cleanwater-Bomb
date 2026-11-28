// Depth-only terrain shadow pass.  This deliberately has a minimal interface:
// the shadow fragment consumes only UV and flags, not the main lighting varyings.

#version 450
#extension GL_GOOGLE_include_directive : require

#include "water_waves3d.glsl"

layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_aux;
layout(location = 2) in vec3 a_inst_pos;
layout(location = 3) in vec3 a_inst_scale;
layout(location = 4) in vec2 a_inst_uv0;
layout(location = 5) in vec2 a_inst_uv1;
layout(location = 6) in vec4 a_inst_color;
layout(location = 7) in float a_inst_flags;
layout(location = 8) in float a_inst_pad;
layout(location = 9) in vec4 a_inst_emission;
layout(location = 10) in float a_inst_logical_z;

layout(set = 0, binding = 0) uniform sampler2D height_tex;

layout(set = 1, binding = 0) uniform UBO {
    mat4 mvp;
    vec4 cam_right;
    vec4 cam_up;
    vec4 params;
    vec4 sun_dir;
    vec4 water_vertex;
    vec4 water_flow;
    vec4 height_mapping;
};

#include "heightfield3d.glsl"

layout(location = 1) out vec2 v_uv;
layout(location = 2) out float v_flags;

void main()
{
    int mode = int(params.x + 0.5);
    vec3 world;
    vec2 uv_local;
    if( mode == 2 || mode == 3 ) {
        vec3 rgt = cam_right.xyz;
        if( mode == 3 ) {
            if( abs( rgt.x ) >= abs( rgt.y ) ) {
                rgt = vec3( sign( rgt.x ), 0.0, 0.0 );
            } else {
                rgt = vec3( 0.0, sign( rgt.y ), 0.0 );
            }
        }
        world = a_inst_pos + rgt * ( a_pos.x * a_inst_scale.x )
              + cam_up.xyz * ( a_pos.y * a_inst_scale.y );
        uv_local = a_aux.xy;
    } else if( mode == 4 ) {
        vec3 axis = a_inst_pad > 0.5 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
        world = a_inst_pos + axis * ( a_pos.x * a_inst_scale.x )
              + cam_up.xyz * ( a_pos.y * a_inst_scale.y );
        int iflags = int( a_inst_flags + 0.5 );
        uv_local = ( iflags & 256 ) != 0 ? vec2( a_aux.y, a_aux.x ) : a_aux.xy;
    } else if( mode == 5 ) {
        world = a_inst_pos + vec3( a_pos.x * a_inst_scale.x, a_pos.y * a_inst_scale.y, 0.0 );
        int iflags = int( a_inst_flags + 0.5 );
        int rota = ( iflags >> 2 ) & 3;
        vec2 q = a_pos.xy;
        if( rota == 1 ) {
            q = vec2( q.y, 1.0 - q.x );
        } else if( rota == 2 ) {
            q = vec2( 1.0 - q.x, 1.0 - q.y );
        } else if( rota == 3 ) {
            q = vec2( 1.0 - q.y, q.x );
        }
        uv_local = q;
    } else if( mode == 1 ) {
        world = a_inst_pos + a_pos * a_inst_scale;
        uv_local = a_aux.xy;
    } else {
        world = a_inst_pos + a_pos * a_inst_scale;
        vec3 n = a_aux;
        int iflags = int( a_inst_flags + 0.5 );
        int rota = ( iflags >> 2 ) & 3;
        if( abs( n.z ) > 0.5 ) {
            vec2 q = a_pos.xy;
            if( rota == 1 ) {
                q = vec2( q.y, 1.0 - q.x );
            } else if( rota == 2 ) {
                q = vec2( 1.0 - q.x, 1.0 - q.y );
            } else if( rota == 3 ) {
                q = vec2( 1.0 - q.y, q.x );
            }
            uv_local = q;
        } else {
            float su = ( abs( n.y ) > 0.5 ) ? a_pos.x : a_pos.y;
            float sv = 1.0 - a_pos.z;
            if( ( iflags & 16 ) != 0 ) {
                sv = ( a_inst_pad - a_inst_uv0.y ) / max( a_inst_uv1.y - a_inst_uv0.y, 1e-6 );
            }
            uv_local = vec2( su, sv );
            if( ( iflags & 32 ) != 0 ) {
                bool wide = ( abs( n.y ) > 0.5 && a_inst_scale.x >= a_inst_scale.y ) ||
                            ( abs( n.x ) > 0.5 && a_inst_scale.y > a_inst_scale.x );
                if( wide ) {
                    uv_local = vec2( uv_local.y, 1.0 - uv_local.x );
                }
            }
        }
    }
    int flags = int( a_inst_flags + 0.5 );
    if( height_mapping.w > 0.5 && ( flags & 262144 ) != 0 ) {
        vec2 anchor_xy = a_inst_pos.xy + 0.5 * a_inst_scale.xy;
        world.z += terrain_height_at( world.xy ) - terrain_height_at( anchor_xy );
    }
    if( water_vertex.w > 0.0 && ( flags & 16384 ) != 0 &&
        ( mode == 5 || ( mode == 0 && a_aux.z > 0.5 ) ) ) {
        world.z += water_wave_height( world.xy + water_vertex.xy, water_flow.xy,
                                      water_vertex.z, water_vertex.w, water_flow.z );
    }
    if( ( flags & 16384 ) != 0 &&
        !( ( mode == 0 && a_aux.z > 0.5 ) || mode == 5 ) ) {
        flags &= ~16384;
    }
    gl_Position = mvp * vec4( world, 1.0 );
    v_uv = mix( a_inst_uv0, a_inst_uv1, uv_local );
    v_flags = float( flags );
}
