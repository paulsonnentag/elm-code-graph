module Main exposing (..)

import Html exposing (..)
import Html.Attributes exposing (class, cols, rows, value, disabled, style)
import Html.Events exposing (onInput, onClick)
import LineChart
import LineChart.Dots as Dots
import Color
import Dict exposing (Dict)
import Http
import Json.Decode as Decode


main : Program Never Model Msg
main =
    Html.program
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }



--- MODEL


type alias Model =
    { loading : Bool
    , query : String
    , result : Maybe (Result Http.Error GraphData)
    }


type alias GraphData =
    Dict String (List Float)


init : ( Model, Cmd Msg )
init =
    let
        query =
            "MATCH (r:Repo) \nWHERE r.lastUpdated <= $timestamp AND r.created >= $timestamp \nRETURN count(r) as value, 'activeRepos' as label"
    in
        ( { loading = False
          , query = query
          , result = Nothing
          }
        , Http.send LoadResult (queryRequest query)
        )


queryRequest : String -> Http.Request GraphData
queryRequest query =
    Http.get ("http://localhost:3000?q=" ++ (Http.encodeUri query)) decodeData


decodeData : Decode.Decoder GraphData
decodeData =
    Decode.dict (Decode.list Decode.float)



-- UPDATE


type Msg
    = LoadResult (Result Http.Error GraphData)
    | UpdateQuery String
    | RunQuery


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        LoadResult result ->
            ( { model | loading = False, result = Just result }, Cmd.none )

        UpdateQuery query ->
            ( { model | query = query }, Cmd.none )

        RunQuery ->
            ( { model | loading = True, result = Nothing }, Http.send LoadResult (queryRequest model.query) )



-- VIEW


boxSizingStyle =
    [ ( "box-sizing", "border-box" ) ]


appStyle =
    boxSizingStyle
        ++ [ ( "background-color", "rgb(210,213,218)" )
           , ( "height", "100%" )
           , ( "width", "100%" )
           , ( "padding", "20px" )
           ]


queryBoxStyle =
    boxSizingStyle
        ++ [ ( "padding", "12px" )
           , ( "margin-bottom", "10px" )
           , ( "background", "rgb(239, 239, 244)" )
           , ( "box-shadow", "rgba(0, 0, 0, 0.1) 0px 1px 4px" )
           , ( "display", "flex" )
           , ( "flex-direction", "row" )
           , ( "align-items", "center" )
           ]


textAreaStyle =
    boxSizingStyle
        ++ [ ( "border-radius", "5px" )
           , ( "border", "0" )
           , ( "outline", "0" )
           , ( "width", "100%" )
           ]


buttonStyle =
    boxSizingStyle
        ++ [ ( "width", "50px" )
           , ( "height", "50px" )
           , ( "margin-left", "10px" )
           , ( "background", "transparent" )
           , ( "border", "0" )
           , ( "background-image", "url('assets/run.svg')" )
           , ( "background-size", "contain" )
           , ( "background-position", "center" )
           , ( "background-repeat", "no-repeat" )
           ]


graphStyle =
    boxSizingStyle
        ++ [ ( "box-shadow", "rgba(0, 0, 0, 0.1) 0px 1px 4px" )
           , ( "background", "white" )
           ]


errorStyle =
    boxSizingStyle ++ [ ( "padding", "10px" ) ]


view : Model -> Html Msg
view { loading, query, result } =
    div [ style appStyle ]
        [ div
            [ style queryBoxStyle ]
            [ textarea
                [ rows 4
                , value query
                , onInput UpdateQuery
                , disabled loading
                , style textAreaStyle
                ]
                []
            , button
                [ onClick RunQuery
                , disabled loading
                , style buttonStyle
                ]
                [ text "" ]
            ]
        , div [ style graphStyle ]
            [ case result of
                Nothing ->
                    text ""

                Just result ->
                    case result of
                        Ok sequences ->
                            chart sequences

                        Err message ->
                            pre [ style errorStyle ]
                                [ text ("Error: " ++ (toString message)) ]
            ]
        ]


chart : GraphData -> Html.Html msg
chart graph =
    LineChart.view
        (\( key, value ) -> toFloat key)
        (\( key, value ) -> value)
        (graph
            |> Dict.map graphSequenceToLine
            |> Dict.values
        )


graphSequenceToLine : String -> List Float -> LineChart.Series ( Int, Float )
graphSequenceToLine label values =
    LineChart.line Color.red Dots.none label (List.indexedMap (,) values)



-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions model =
    Sub.none
