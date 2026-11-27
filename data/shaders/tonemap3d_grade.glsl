#ifndef TONEMAP3D_GRADE_GLSL
#define TONEMAP3D_GRADE_GLSL

#include "color3d.glsl"

layout(set = 3, binding = 0) uniform PostUBO {
    vec4 look;           // x = exposure, y = saturation, z = contrast, w = night vision
    vec4 shadow_color;   // rgb = shadow balance, w = strength
    vec4 highlight_color; // rgb = highlight balance, w = strength
    vec4 presentation;   // x = vignette, y = output dither
};

vec3 tonemap3d_present( vec3 hdr, vec2 uv )
{
    if( look.w > 0.5 ) {
        return clamp( color3d_linear_to_srgb( hdr ), 0.0, 1.0 );
    }
    vec3 rgb = color3d_aces( max( hdr, vec3( 0.0 ) ) * look.x );
    rgb = color3d_linear_to_srgb( rgb );
    float luma = color3d_luminance( rgb );

    float shadow = ( 1.0 - smoothstep( 0.06, 0.58, luma ) ) * shadow_color.w;
    float highlight = smoothstep( 0.42, 0.96, luma ) * highlight_color.w;
    rgb *= mix( vec3( 1.0 ), shadow_color.rgb, shadow );
    rgb *= mix( vec3( 1.0 ), highlight_color.rgb, highlight );

    luma = color3d_luminance( rgb );
    rgb = mix( vec3( luma ), rgb, look.y );
    rgb = ( rgb - vec3( 0.42 ) ) * look.z + vec3( 0.42 );

    vec2 centered = ( uv - 0.5 ) * vec2( 1.0, 0.78 );
    float vignette = 1.0 - presentation.x * smoothstep( 0.22, 0.66, length( centered ) );
    rgb *= vignette;
    float noise = fract( sin( dot( gl_FragCoord.xy, vec2( 12.9898, 78.233 ) ) ) *
                         43758.5453 ) - 0.5;
    rgb += noise * presentation.y / 255.0;
    return clamp( rgb, 0.0, 1.0 );
}

#endif
